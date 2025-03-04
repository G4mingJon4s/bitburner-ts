type SchemaParseResult<T, E extends SchemaError = SchemaError> =
  | { success: true; data: T }
  | { success: false; error: E };

export abstract class Schema<Output> {
  safeParse(v: unknown): SchemaParseResult<Output> {
    throw new Error("abstract implementation missing");
  }

  parse(v: unknown): Output {
    const result = this.safeParse(v);
    if (result.success) return result.data;
    throw result.error;
  }

  refine(func: (value: Output) => boolean, message?: string | ((value: Output) => string)): SchemaRefine<Output> {
    return new SchemaRefine(this, func, message ?? "Input does not meet refined requirements.");
  }

  array(): SchemaArray<Schema<Output>> {
    return new SchemaArray(this);
  }

  optional(): SchemaOptional<Schema<Output>> {
    return new SchemaOptional(this);
  }

  or<P extends Schema<any>, O extends Schema<any>[]>(other: P, ...more: O): SchemaUnion<[Schema<Output>, P, ...O]> {
    return new SchemaUnion([this, other, ...more]);
  }

  and<P extends Schema<any>>(other: P): SchemaIntersection<[Schema<Output>, P]> {
    return new SchemaIntersection([this, other]);
  }
}

type SchemaInfer<T extends Schema<any>> = T extends Schema<infer U> ? U : never;

class SchemaError extends Error {
  constructor(message: string) {
    super(message);
  }
}

class SchemaUnionError extends SchemaError {
  constructor(messages: string[]) {
    super(["Value did not match the union", ...messages].join("; "));
  }

  static fromErrors(errors: SchemaError[]) {
    return new SchemaUnionError(errors.map(e => e.message));
  }
}

class SchemaRefine<T> extends Schema<T> {
  private schema: Schema<T>;
  private validator: (value: T) => boolean;
  private message: string | ((value: T) => string);
  constructor(schema: Schema<T>, validator: (value: T) => boolean, message: string | ((value: T) => string)) {
    super();

    this.schema = schema;
    this.validator = validator;
    this.message = message;
  }

  safeParse(v: unknown): SchemaParseResult<T> {
    const parsed = this.schema.safeParse(v);
    if (!parsed.success) return { success: false, error: parsed.error };
    if (!this.validator(parsed.data)) return { success: false, error: new SchemaError(typeof this.message === "string" ? this.message : this.message(parsed.data)) };
    return { success: true, data: parsed.data };
  }
}

class SchemaOptional<T extends Schema<any>> extends Schema<SchemaInfer<T> | undefined> {
  private schema: T;
  constructor(schema: T) {
    super();
    this.schema = schema;
  }

  safeParse(v: unknown): SchemaParseResult<SchemaInfer<T> | undefined> {
    if (v === undefined) return { success: true, data: v };
    return this.schema.safeParse(v);
  }

  required(): T {
    return this.schema;
  }
}

class SchemaString extends Schema<string> {
  safeParse(v: unknown): SchemaParseResult<string> {
    if (typeof v !== "string") return { success: false, error: new SchemaError(`'${v}' is not a string.`) };
    return { success: true, data: v };
  }
}

class SchemaNumber extends Schema<number> {
  safeParse(v: unknown): SchemaParseResult<number> {
    if (typeof v !== "number") return { success: false, error: new SchemaError(`'${v}' is not a number.`) };
    return { success: true, data: v };
  }
}

class SchemaBoolean extends Schema<boolean> {
  safeParse(v: unknown): SchemaParseResult<boolean> {
    if (typeof v !== "boolean") return { success: false, error: new SchemaError(`'${v}' is not a boolean.`) };
    return { success: true, data: v };
  }

  true(): SchemaTrue {
    return new SchemaTrue();
  }

  false(): SchemaFalse {
    return new SchemaFalse();
  }
}

class SchemaTrue extends Schema<true> {
  safeParse(v: unknown): SchemaParseResult<true> {
    if (typeof v !== "boolean" || v !== true) return { success: false, error: new SchemaError(`'${v}' is not true.`) };
    return { success: true, data: true };
  }
}

class SchemaFalse extends Schema<false> {
  safeParse(v: unknown): SchemaParseResult<false> {
    if (typeof v !== "boolean" || v !== false) return { success: false, error: new SchemaError(`'${v}' is not false.`) };
    return { success: true, data: false };
  }
}

class SchemaObject<T extends null | Record<string, Schema<any>>> extends Schema<T extends Record<string, Schema<any>> ? {
  [K in keyof T]: SchemaInfer<T[K]>
} : null> {
  private schema: T;
  constructor(schema: T) {
    super();
    this.schema = schema;
  }

  safeParse(v: unknown): SchemaParseResult<T extends Record<string, Schema<any>> ? { [K in keyof T]: SchemaInfer<T[K]> } : null> {
    if (typeof v !== "object") return { success: false, error: new SchemaError("Input is not a valid object.") };
    if (this.schema === null) {
      if (v !== null) return { success: false, error: new SchemaError(`Expected null, got: '${JSON.stringify(v)}'`) };
      return { success: true, data: null as any };
    }
    if (v === null) return { success: false, error: new SchemaError("Expected an object, got 'null'") };

    const result: any = {};
    for (const key in this.schema) {
      const fieldValidator = this.schema[key];

      if (!(key in v)) return { success: false, error: new SchemaError(`Missing property '${key}'.`) };
      const fieldValue = (v as Record<string, unknown>)[key];

      const parsed = fieldValidator.safeParse(fieldValue);

      if (!parsed.success) {
        return { success: false, error: new SchemaError(`Error in key '${key}': ${parsed.error}`) };
      }

      result[key] = parsed.data;
    }

    return { success: true, data: result };
  }
}

class SchemaArray<T extends Schema<any>> extends Schema<SchemaInfer<T>[]> {
  private schema: T;
  constructor(schema: T) {
    super();
    this.schema = schema;
  }

  safeParse(v: unknown): SchemaParseResult<SchemaInfer<T>[]> {
    if (!Array.isArray(v)) return { success: false, error: new SchemaError("Input is not a valid array.") };

    const result: any = Array.from(v, () => null);
    for (let i = 0; i < v.length; i++) {
      const parsed = this.schema.safeParse(v[i]);
      if (!parsed.success) return { success: false, error: new SchemaError(`Error at index ${i}: $${parsed.error}`) };
      result[i] = parsed.data;
    }

    return { success: true, data: result };
  }
}

class SchemaTuple<T extends Schema<any>[]> extends Schema<{
  [K in keyof T]: SchemaInfer<T[K]>
}> {
  private schema: T;
  constructor(schema: T) {
    super();
    this.schema = schema;
  }

  safeParse(v: unknown): SchemaParseResult<{ [K in keyof T]: SchemaInfer<T[K]> }> {
    if (!Array.isArray(v)) return { success: false, error: new SchemaError("Input is not a valid tuple.") };
    if (v.length !== this.schema.length) return { success: false, error: new SchemaError(`Invalid tuple length of ${v.length}, expected a length of ${this.schema.length}.`) };

    const result: any = Array.from(v, () => null);
    for (let i = 0; i < v.length; i++) {
      const parsed = this.schema[i].safeParse(v[i]);
      if (!parsed.success) return { success: false, error: new SchemaError(`Error at index ${i}: ${parsed.error}`) };
      result[i] = parsed.data;
    }

    return { success: true, data: result };
  }
}

class SchemaUnion<T extends [Schema<any>, ...Schema<any>[]]> extends Schema<SchemaInfer<T[number]>> {
  private schema: T;
  constructor(schema: T) {
    super();
    this.schema = schema;
  }

  safeParse(v: unknown): SchemaParseResult<SchemaInfer<T[number]>, SchemaUnionError> {
    const results = this.schema.map(e => e.safeParse(v));

    const correct = results.find(r => r.success);
    if (correct) return correct;

    return { success: false, error: SchemaUnionError.fromErrors(results.map(r => r.success ? null : r.error).filter((n): n is SchemaError => n !== null)) };
  }
}

class SchemaIntersection<T extends [Schema<any>, Schema<any>]> extends Schema<SchemaInfer<T[0]> & SchemaInfer<T[1]>> {
  private schema: T;
  constructor(schema: T) {
    super();
    this.schema = schema;
  }

  safeParse(v: unknown): SchemaParseResult<SchemaInfer<T[0]> & SchemaInfer<T[1]>> {
    const aResult = this.schema[0].safeParse(v);
    if (!aResult.success) return aResult;

    const bResult = this.schema[1].safeParse(v);
    if (!bResult.success) return bResult;

    if (typeof aResult.data === "object" && typeof bResult.data === "object") {
      return { success: true, data: { ...aResult.data, ...bResult.data } };
    }

    return bResult.data;
  }
}

class SchemaAny extends Schema<any> {
  safeParse(v: unknown): SchemaParseResult<any> {
    return { success: true, data: v };
  }
}

export const string = () => new SchemaString();
export const number = () => new SchemaNumber();
export const boolean = () => new SchemaBoolean();
export const any = () => new SchemaAny();
export const object = <T extends null | Record<string, Schema<any>>>(schema: T) => new SchemaObject(schema);
export const array = <T extends Schema<any>>(schema: T) => new SchemaArray(schema);
export const tuple = <T extends Schema<any>[]>(...schema: T) => new SchemaTuple(schema);
export const union = <T extends [Schema<any>, ...Schema<any>[]]>(...schema: T) => new SchemaUnion(schema);
export type infer<T extends Schema<any>> = SchemaInfer<T>;