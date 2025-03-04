import * as t from "util/schema.ts";

/*
- Add a default main function for when the script is launched automatically via ns.exec (=> ns.self().parent)
- Different entry points for different commands
- Different arguments and flags for different commands
- A "hook" for basic argument validation (no need for createCLI, just pass a cli data object)

// Basic Hook, everything still goes through one entry point
const app = createCLI(c => c
  .arg("server", t.string(), data => data.servers)
  .arg("ram", t.number().refine(v => v >= 1, "ram has to be at least 1GB"))
  .flag("backdoor", t.boolean(), {
    default: true,
    tab: ["true", "false"],
  }), // This is the default entry, the actual definition is detached from this
{
  description: "My script!",
  version: "1.0.0",
}).
  command("slice", c => c
    .arg("text", t.string())
    .flag("sep", t.string(), {
      default: ",",
      alt: ["s", "separator"],
    })
    .entry((args, flags) => async ns => {
      ns.tprint(`Sliced text: ${JSON.stringify(args[0].split(flags.sep))}`);
    }) // These are other entry points based on the command, sub-commands are possible too
    // The implementation is defined in here
  )

export async function main(ns: NS) {
  // No commands are allowed when using hooks, since the entry point is universal
  // Only the default command will be allowed
  // The help message is different when passing --help here, since all commands are stripped
  const { args, flags } = useCLI(app);

  const [server, ram] = args;
  const { backdoor } = flags;
}


// Full CLI
export const { main, autocomplete } = initCLI(app, (args, flags) => async ns => {
  ns.tprint("Default entry point");
});
// Everything is handled by this function
// Commands can be used and the help message displays the entire range of things the user can do
// The default entry point for scripts and when no commands have been passed is defined here
*/

type AllowedTypes = string | number | boolean;

type FlagOptions = {
  suggestions?: string[] | ((data: AutocompleteData) => string[]);
  synonyms?: string[];
};
type Flag<S extends string, O extends AllowedTypes> = FlagOptions & {
  name: S;

  schema: t.Schema<O>;
  defaultValue: O;
};
type AnyFlags = { [key: string]: Flag<typeof key, any> };

type ArgOptions = {
  suggestions?: string[] | ((data: AutocompleteData) => string[]);
};
type Arg<O extends AllowedTypes> = ArgOptions & {
  name: string;

  schema: t.Schema<O>;
};

class CLI<Args extends Arg<any>[] = [], Flags extends AnyFlags = {}> {
  args: Args;
  flags: Flags;

  description?: string;

  private constructor(args: Args, flags: Flags, description?: string) {
    this.args = args;
    this.flags = flags;

    if (description) this.description = description;
  }

  arg<O extends AllowedTypes>(name: string, schema: t.Schema<O>, opts: ArgOptions = {}): CLI<[...Args, Arg<O>], Flags> {
    return new CLI([...this.args, {
      name,
      schema,
      ...opts
    } satisfies Arg<O>], this.flags, this.description);
  }

  flag<S extends string, O extends AllowedTypes>(name: S, schema: t.Schema<O>, defaultValue: O, opts: FlagOptions = {}): CLI<Args, Flags & Record<S, Flag<S, O>>> {
    return new CLI(this.args, {
      ...this.flags,
      [name]: {
        name,
        schema,
        defaultValue,
        ...opts
      }
    });
  }

  static create(): CLI {
    return new CLI([], {});
  }
}

const app = CLI.create()
  .arg("server", t.string(), { suggestions: data => data.servers })
  .arg("ram", t.number(), { suggestions: Array.from({ length: 10 }, (_, i) => i).map(a => a.toString()) })
  .flag("backdoor", t.boolean(), true, { synonyms: ["b"], suggestions: ["true", "false"] })