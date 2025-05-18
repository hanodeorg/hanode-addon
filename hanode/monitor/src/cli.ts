import { Command } from 'commander';

export function parseCliArgs() {
    let program = new Command();
    program = program.description('Hanode monitor');
    program = program.argument('<srcDir>', 'Path to the source dir, containing hanode.config.json');
    program = program.argument('<destDir>', 'Path to the destination directory');
    program = program.showHelpAfterError();
    program.parse();
    return {
        srcDir: program.args[0],
        destDir: program.args[1],
    };
}
