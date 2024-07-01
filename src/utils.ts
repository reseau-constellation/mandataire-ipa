import TypedEmitter, { type EventMap } from "typed-emitter";

export const lorsque = async <T extends EventMap>(
  émetteur: TypedEmitter<T>,
  clef: keyof T,
): Promise<Parameters<T[keyof T]>> => {
  return new Promise((résoudre) => {
    return émetteur.once(clef, résoudre as T[keyof T]);
  });
};
