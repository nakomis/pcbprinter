declare module '@jscad/stl-serializer' {
  export function serialize(options: { binary: boolean }, ...geometries: unknown[]): ArrayBuffer[];
}
