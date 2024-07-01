import TypedEmitter, { type EventMap } from "typed-emitter";

export const lorsque = async <Events extends EventMap, E extends keyof Events>(
  émetteur: TypedEmitter<Events>,
  clef: E,
): Promise<Parameters<Events[E]>[0]> => {
  return new Promise((résoudre) => {
    return émetteur.once(clef, résoudre as Events[E]);
  });
};
