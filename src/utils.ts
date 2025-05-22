import {TypedEmitter, type ListenerSignature, type DefaultListener} from "tiny-typed-emitter";

export const lorsque = async <U extends keyof L, L extends ListenerSignature<L> = DefaultListener>(
  émetteur: TypedEmitter<L>,
  clef: U,
): Promise<Parameters<L[U]>[0]> => {
  return new Promise((résoudre) => {
    return émetteur.once(clef, résoudre as L[U]);
  });
};
