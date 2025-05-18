import { z } from 'zod';

const PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const ConfigProjectSchema = z.object({
    path: z.string(),
    run_command: z.string().optional(),
    build_command: z.string().optional(),
    library: z.boolean().optional(),
    pkg: z.enum(PACKAGE_MANAGERS).optional(),
});
export type ConfigProject = z.infer<typeof ConfigProjectSchema>;

export const HanodeProjectConfigSchema = z.object({
    v: z.literal(1),
    projects: z.array(ConfigProjectSchema),
});
export type HanodeProjectConfig = z.infer<typeof HanodeProjectConfigSchema>;

export function parseWithZod<S extends z.Schema>(schemaName: string, schema: S, value: unknown): z.infer<S> {
    const parseResult = schema.safeParse(value);
    if (parseResult.success === false) {
        throw new Error(
            `Parsing error, invalid ${schemaName}: ${parseResult.error.errors
                .map((error) => `[${error.code} ${error.path}] ${error.message}`)
                .join(', ')}: ${JSON.stringify(value, null, 2)}`,
        );
    }
    return parseResult.data;
}
