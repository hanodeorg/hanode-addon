const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");
const httpBackend = require("git-http-backend");
const basicAuth = require("express-basic-auth");

const app = express();
const PORT = 80;
const GIT_PROJECT_ROOT = "/home/git/repos";
const REPO_NAME = "my-hanode-project.git";
const DEPLOY_PATH = "/var/www/hanode-app";

// Basic authentication middleware
const auth = basicAuth({
  users: { hanode: "hanode" },
  challenge: true,
  realm: "Git Repository",
});

// Serve static files and directory listing for the repo root
app.use(
  "/",
  express.static(GIT_PROJECT_ROOT, {
    dotfiles: "allow",
    index: ["index.html"],
  })
);

// Enable debug logging
const debug = (message) => {
  console.log(`[DEBUG] ${message}`);
};

// Create a welcome/help page
app.get("/", (req, res) => {
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <title>Hanode Git Repository</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
        pre { background: #f4f4f4; padding: 10px; border-radius: 3px; overflow-x: auto; }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { color: #333; }
        .instruction { margin-bottom: 20px; }
        .note { color: #e74c3c; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Git Repository Access</h1>
        <p>This server hosts a git repository that can be accessed via HTTP.</p>

        <div class="instruction">
            <h2>Authentication</h2>
            <p>When prompted, use these credentials:</p>
            <ul>
                <li>Username: <code>hanode</code></li>
                <li>Password: <code>hanode</code></li>
            </ul>
        </div>

        <div class="instruction">
            <h2>Using Git</h2>
            <p>Add the repository as a remote using:</p>
            <code>git remote add hanode http://localhost:7622/git/${REPO_NAME}</code>
            <p>Then push your code:</p>
            <code>git push hanode YOUR_BRANCH</code>
        </div>

        <div class="instruction">
            <h2>Repository Information</h2>
            <p>The repository is located at:</p>
            <code>${GIT_PROJECT_ROOT}/${REPO_NAME}</code>
            <p>Pushed code is automatically deployed to:</p>
            <code>${DEPLOY_PATH}</code>
        </div>
    </div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html");
  res.send(htmlContent);
});

// Initialize the repository if it doesn't exist or is empty
function ensureRepoExists() {
  const repoPath = path.join(GIT_PROJECT_ROOT, REPO_NAME);

  // Mark the repository as a safe directory to fix the dubious ownership error
  try {
    debug("Marking repository as a safe directory");
    execSync(`git config --global --add safe.directory ${repoPath}`);
    execSync('git config --global --add safe.directory "*"');
  } catch (err) {
    console.error("Error marking repository as safe:", err);
  }

  // Create the repo if it doesn't exist
  if (!fs.existsSync(repoPath)) {
    console.log(`Creating bare repository at ${repoPath}`);
    execSync(`git init --bare ${repoPath}`);
  }

  // Check if the repo is empty (no master or main branch)
  const mainRefPath = path.join(repoPath, "refs/heads/main");
  const masterRefPath = path.join(repoPath, "refs/heads/master");

  if (!fs.existsSync(mainRefPath) && !fs.existsSync(masterRefPath)) {
    console.log("Creating initial commit in the repository");

    // Create a temporary directory for the initial commit
    const tmpDir = fs.mkdtempSync("/tmp/git-init-");

    try {
      const commands = [
        `cd ${tmpDir}`,
        "git init",
        'git config user.email "hanode@example.com"',
        'git config user.name "Hanode Addon"',
        'echo "# My Hanode Project" > README.md',
        "git add README.md",
        'git commit -m "Initial commit"',
        `git remote add origin ${repoPath}`,
        'git config --global --add safe.directory "*"', // Add again just to be safe
        "git push origin master",
      ];

      // Execute commands synchronously to ensure they complete
      execSync(commands.join(" && "));
      console.log("Initial commit created successfully");
    } catch (err) {
      console.error("Error creating initial commit:", err);
    } finally {
      // Clean up the temp directory
      try {
        fs.rmdirSync(tmpDir, { recursive: true });
      } catch (err) {
        console.error("Error removing temp directory:", err);
      }
    }
  }

  // Ensure the post-receive hook is executable
  const hookPath = path.join(repoPath, "hooks/post-receive");
  if (fs.existsSync(hookPath)) {
    fs.chmodSync(hookPath, "755");
  } else {
    // Create default post-receive hook if it doesn't exist
    const hookContent = `#!/bin/bash

GIT_WORK_TREE="${DEPLOY_PATH}"
export GIT_WORK_TREE
mkdir -p "$GIT_WORK_TREE"

while read oldrev newrev ref; do
  branch=$(echo "$ref" | sed -e 's,.*/\\(.*\\),\\1,')
  echo "Received push to branch: $branch (old: $oldrev new: $newrev)" >> /tmp/git-hook.log

  if [ "$branch" = "master" ] || [ "$branch" = "main" ] || [ "$branch" = "release" ]; then
    echo "Deploying $branch branch to $GIT_WORK_TREE" >> /tmp/git-hook.log
    git --work-tree="$GIT_WORK_TREE" --git-dir="${GIT_PROJECT_ROOT}/${REPO_NAME}" checkout -f $branch
    echo "Deployment completed successfully" >> /tmp/git-hook.log
  else
    echo "Not deploying branch $branch" >> /tmp/git-hook.log
  }
done
`;
    fs.writeFileSync(hookPath, hookContent);
    fs.chmodSync(hookPath, "755");
  }
}

// Git HTTP backend handler with improved stream handling
app.use("/git", auth, function (req, res) {
  debug(`Git request: ${req.method} ${req.url}`);

  // Skip the auth basic challenge for some URLs to allow git clients to work properly
  const match = req.url.match(/\/([^\/]+)\/info\/refs\?service=([^\/]+)$/);

  // Parse the repo path from the URL
  const repoName = req.url.split("/")[1] || REPO_NAME;
  const repoPath = path.join(GIT_PROJECT_ROOT, repoName);

  debug(`Repository path: ${repoPath}`);

  const service = match && match[2];

  // Handle git info/refs requests (used during git clone/fetch/push initialization)
  if (service) {
    debug(`Service: ${service}`);

    res.setHeader("Content-Type", `application/x-${service}-advertisement`);
    res.setHeader("Cache-Control", "no-cache");

    const args = ["--stateless-rpc", "--advertise-refs", repoPath];
    const cmd = service === "git-upload-pack" ? "upload-pack" : "receive-pack";

    debug(`Running: git ${cmd} ${args.join(" ")}`);

    const ps = spawn("git", [cmd, ...args]);

    ps.on("error", (err) => {
      console.error("Git command error:", err);
      res.status(500).end();
    });

    // Write the correct protocol header
    res.write(`001f# service=${service}\n0000`);

    // Pipe the git command output to response
    ps.stdout.pipe(res);

    // Handle errors
    ps.stderr.on("data", (data) => {
      console.error(`Git stderr: ${data}`);
    });

    return;
  }

  // Handle git upload-pack and receive-pack operations
  if (
    req.url.indexOf("git-upload-pack") > 0 ||
    req.url.indexOf("git-receive-pack") > 0
  ) {
    const cmd =
      req.url.indexOf("git-upload-pack") > 0 ? "upload-pack" : "receive-pack";
    debug(`Running git ${cmd} process`);

    const ps = spawn("git", [cmd, "--stateless-rpc", repoPath]);

    ps.on("error", (err) => {
      console.error("Git command error:", err);
      return res.status(500).end();
    });

    req.pipe(ps.stdin);
    ps.stdout.pipe(res);

    ps.stderr.on("data", (data) => {
      console.error(`Git stderr: ${data}`);
    });

    ps.on("exit", (code) => {
      debug(`Git ${cmd} process exited with code ${code}`);

      // If this was a receive-pack (git push), execute post-receive hook manually
      if (cmd === "receive-pack" && code === 0) {
        debug("Triggering post-receive hook");
        try {
          // Update server info to ensure git references are up to date
          execSync(`cd ${repoPath} && git update-server-info`);

          // Run post-receive hook to deploy the code
          const hookPath = path.join(repoPath, "hooks/post-receive");
          if (fs.existsSync(hookPath)) {
            console.log("Running post-receive hook");
            execSync(
              `cd ${repoPath} && chmod +x hooks/post-receive && ./hooks/post-receive`
            );
          }
        } catch (err) {
          console.error("Error in post-receive processing:", err);
        }
      }
    });

    return;
  }

  // For any other git request, send a simple 404
  res.status(404).send("Not Found");
});

// Start the server
ensureRepoExists();

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Git HTTP server running on port ${PORT}`);
});
