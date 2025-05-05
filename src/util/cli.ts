import * as t from "util/schema.ts";

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

type AnyCLI = CLI<Arg<any>[], AnyFlags, string | undefined>;
class CLI<
  Args extends Arg<any>[] = [],
  Flags extends AnyFlags = { "help": Flag<"help", boolean> },
  Desc extends string | undefined = undefined
> {
  args: Args;
  flags: Flags;

  description: Desc;

  private constructor(args: Args, flags: Flags, description: Desc) {
    this.args = args;
    this.flags = flags;

    this.description = description;
  }

  describe(description: string): CLI<Args, Flags, string> {
    return new CLI(this.args, this.flags, description);
  }

  arg<O extends AllowedTypes>(
    name: string,
    schema: t.Schema<O>,
    opts: ArgOptions = {}
  ): CLI<[...Args, Arg<O>], Flags, Desc> {
    return new CLI([...this.args, {
      name,
      schema,
      ...opts
    } satisfies Arg<O>], this.flags, this.description);
  }

  flag<S extends string, O extends AllowedTypes>(
    name: S,
    schema: t.Schema<O>,
    defaultValue: O,
    opts: FlagOptions = {}
  ): CLI<Args, Omit<Flags, S> & Record<S, Flag<S, O>>, Desc> {
    if (t.isComplex(schema)) throw new Error(`Error when creating flag '${name}'. You can't have a complex type here.`);
    return new CLI(this.args, {
      ...this.flags,
      [name]: {
        name,
        schema,
        defaultValue,
        ...opts
      }
    }, this.description);
  }

  createAutocomplete() {
    const app = this;

    return (data: AutocompleteData): string[] => {
      const rawParts = parseRawCommand(data.command);
      const parts = removeSpecialFlags(rawParts);

      const parsedArgs: string[] = [];
      const handledFlags: string[] = [];

      const getFlagSuggestions = () => {
        const unhandledFlags = Object.values(app.flags).filter(a => !handledFlags.includes(a.name));
        return unhandledFlags.flatMap(a => [a.name, ...(a.synonyms ?? [])].map(toFlagRep));
      };

      for (let i = 0; i < parts.length; i++) {
        const current = parts[i];
        const flag = getFlag(app.flags, current);
        if (!current.startsWith("-") || flag === undefined) {
          parsedArgs.push(current);
          continue;
        }

        if (i === parts.length - 1) return getFlagSuggestions();
        if (i === parts.length - 2 && flag.schema._tag !== "boolean") return getSuggestions(data, flag.suggestions ?? []);

        handledFlags.push(flag.name);
        if (flag.schema._tag !== "boolean") i++; // boolean flags have no param
      }

      const curArg = app.args.at(parsedArgs.length - 1);
      if (curArg === undefined) return getFlagSuggestions();
      return [`[${curArg.name}]`].concat(getFlagSuggestions(), getSuggestions(data, curArg.suggestions ?? []));
    }
  }

  parseArguments = (ns: NS) => {
    const handledArgs: ScriptArg[] = [];
    const flags = Object.fromEntries(Object.entries(this.flags).map(([k, v]) => [k, v.defaultValue]));

    let error = "";
    for (let i = 0; i < ns.args.length; i++) {
      const current = ns.args[i];
      if (typeof current !== "string") {
        handledArgs.push(current);
        continue;
      }

      const flag = getFlag(this.flags, current);
      if (flag === undefined) {
        handledArgs.push(current);
        continue;
      }

      if (flag.schema._tag === "boolean") { // flip default
        flags[flag.name] = !flags[flag.name];
        continue;
      }

      if (i === ns.args.length - 1) {
        error = `Missing param for flag '${flag.name}'. Expected '${flag.schema._tag}'`;
        break;
      }
      const param = flag.schema.safeParse(ns.args[i + 1]);
      if (!param.success) {
        error = `Invalid param for flag '${flag.name}': ${param.error.message}`;
        break;
      }

      flags[flag.name] = param.data;
      i++;
    }

    if (this.flags["help"] !== undefined && this.flags["help"].schema._tag === "boolean" && flags["help"]) {
      const getSynonymsDesc = (f: Flag<string, any>) => f.synonyms === undefined
        ? ""
        : `[${f.synonyms.map(toFlagRep).join(", ")}] `;
      const getFlagDesc = (f: Flag<string, any>) =>
        `${toFlagRep(f.name)} ${getSynonymsDesc(f)}(${f.schema._tag}) [${f.defaultValue}]`;

      ns.tprint(`
Description:
${this.description ?? "There is no description for this script."}

${this.args.length > 0 ? `Arguments:
${this.args.map((a, i) => `${i + 1}. ${a.name} (${a.schema._tag})`).join("\n")}\n` : ""}
Flags:
${Object.values(this.flags).map(getFlagDesc).join("\n")}
`);
      return;
    }

    if (error !== "") {
      ns.tprint(`ERROR: ${error}`);
      return;
    }

    if (handledArgs.length !== this.args.length) {
      ns.tprint(`ERROR: Too ${handledArgs.length < this.args.length ? "few" : "many"} arguments. Expected ${this.args.length}, got ${handledArgs.length}. Did you spell all flags correctly?`);
      return;
    }

    const parsedArgs = [];
    for (let i = 0; i < this.args.length; i++) {
      const parsed = this.args[i].schema.safeParse(handledArgs[i]);
      if (!parsed.success) {
        ns.tprint(`ERROR: Invalid value for argument '${this.args[i].name}'. Expected '${this.args[i].schema._tag}', got '${handledArgs}'`);
        return;
      }
      parsedArgs.push(parsed.data);
    }

    return {
      args: parsedArgs as { [K in keyof Args]: t.infer<Args[K]["schema"]> },
      flags: flags as { [K in keyof Flags]: t.infer<Flags[K]["schema"]> },
    }
  }

  static create(): CLI {
    return new CLI(
      [],
      { "help": { name: "help", schema: t.boolean(), defaultValue: false } },
      undefined
    );
  }
}

// true, if it expects a param
export const SPECIAL_FLAGS = {
  "--tail": false,
  "-t": true,
  "--ram-override": true,
} as Partial<Record<string, boolean>>;

export const parseRawCommand = (command: string): string[] => {
  const parsed: string[] = [];

  let cur = "";
  let inParens = "";
  for (const char of command) {
    if (char === " " && inParens === "") {
      if (cur === "") continue;

      parsed.push(cur);
      cur = "";
      continue;
    }

    if (inParens !== "" && char === inParens) {
      inParens = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      inParens = char;
      continue;
    }
    cur += char;
  }
  if (inParens !== "") cur = inParens + cur;
  parsed.push(cur);

  return parsed.slice(2);
};

export const removeSpecialFlags = (parts: string[]): string[] => {
  const result: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--") return result.concat(parts.slice(i + 1));

    const special = SPECIAL_FLAGS[parts[i]];
    if (special === undefined) {
      result.push(parts[i]);
      continue;
    }
    if (special) i++;
  }

  return result;
};

export const toFlagRep = (s: string) => {
  if (s.length === 1) return "-" + s;
  return "--" + s;
};

export const getFlag = (flagObj: AnyFlags, part: string): Flag<string, any> | undefined => {
  const flags = Object.values(flagObj);

  return flags.find(f => {
    if (toFlagRep(f.name) === part) return true;
    return f.synonyms?.some(s => toFlagRep(s) === part) || false;
  });
};

export const getSuggestions = (
  data: AutocompleteData,
  sug: string[] | ((data: AutocompleteData) => string[])
) => typeof sug === "function" ? sug(data) : sug;

const app = CLI.create()
  .arg("server", t.string(), { suggestions: data => data.servers })
  .arg("ram", t.number(), { suggestions: Array.from({ length: 10 }, (_, i) => i).map(a => a.toString()) })
  .flag("backdoor", t.boolean(), true, { synonyms: ["b"] })
  .flag("connect", t.boolean(), false, { synonyms: ["c"] })
  .flag("log", t.string(), "nothing", { suggestions: ["foo", "bar"] })
  .describe("ABC");

export const autocomplete = app.createAutocomplete();

export async function main(ns: NS) {
  const parsed = app.parseArguments(ns);
  if (parsed === undefined) return;
  const { args, flags } = parsed;

  ns.tprint(`RAN WITH '${JSON.stringify(args)}' and '${JSON.stringify(flags)}'`);
}