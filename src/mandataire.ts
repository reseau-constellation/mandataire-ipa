import type TypedEmitter from "typed-emitter";
import type { types } from "@constl/ipa";

import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "events";

import {
  MessageActionDIpa,
  MessageActionPourIpa,
  MessageDIpa,
  MessageErreurDIpa,
  MessagePourIpa,
  MessageRetourPourIpa,
  MessageSuivrePourIpa,
  MessageSuivrePrêtDIpa,
} from "./messages.js";
import {
  ERREUR_EXÉCUTION_IPA,
  ERREUR_FONCTION_MANQUANTE,
  ERREUR_FORMAT_ARGUMENTS,
  ERREUR_INIT_IPA,
  ERREUR_INIT_IPA_DÉJÀ_LANCÉ,
  ERREUR_MESSAGE_INCONNU,
  ERREUR_MULTIPLES_FONCTIONS,
  ERREUR_PAS_UNE_FONCTION,
} from "./codes.js";
import { lorsque } from "./utils.js";

interface Tâche {
  id: string;
  fSuivre: types.schémaFonctionSuivi<unknown>;
  fRetour: (fonction: string, args?: unknown[]) => Promise<void>;
}

class Callable extends Function {
  // Code obtenu de https://hackernoon.com/creating-callable-objects-in-javascript-d21l3te1
  //@ts-expect-error On ne peut pas appeller super() d'une fonction dans un contexte navigateur sécuritaire
  constructor() {
    const closure = function () {
      // Rien faire. Je ne comprends pas tout ça mais ça fonctionne.
    };
    return Object.setPrototypeOf(closure, new.target.prototype);
  }
}

export type ErreurMandataire = { code: string; erreur: string; id?: string };

type ÉvénementsMandataire = {
  erreur: (e: ErreurMandataire) => void;
};

export abstract class Mandatairifiable extends Callable {
  dernièreErreur?: ErreurMandataire;
  événements: TypedEmitter<ÉvénementsMandataire>;
  événementsInternes: TypedEmitter<{
    [id: string]: (
      x: MessageActionDIpa | MessageSuivrePrêtDIpa | MessageErreurDIpa,
    ) => void;
  }>;
  tâches: { [key: string]: Tâche };

  constructor() {
    super();

    this.événements = new EventEmitter() as TypedEmitter<ÉvénementsMandataire>;
    this.événementsInternes = new EventEmitter() as TypedEmitter<{
      [id: string]: (
        x: MessageActionDIpa | MessageSuivrePrêtDIpa | MessageErreurDIpa,
      ) => void;
    }>;

    this.tâches = {};
  }

  __call__(
    fonction: string[],
    args: { [key: string]: unknown } = {},
  ): Promise<unknown> {
    if (typeof args !== "object")
      this.erreur({
        code: ERREUR_FORMAT_ARGUMENTS,
        erreur: `La fonction ${fonction.join(
          ".",
        )} fut appelée avec arguments ${args}. 
      Toute fonction mandataire Constellation doit être appelée avec un seul argument en format d'objet (dictionnaire).`,
      });
    const id = uuidv4();
    const nomArgFonction = Object.entries(args).find(
      (x) => typeof x[1] === "function",
    )?.[0];

    if (nomArgFonction) {
      return this.appelerFonctionSuivre(id, fonction, args, nomArgFonction);
    } else {
      return this.appelerFonctionAction(id, fonction, args);
    }
  }

  async appelerFonctionSuivre(
    id: string,
    fonction: string[],
    args: { [key: string]: unknown },
    nomArgFonction: string,
  ): Promise<
    | types.schémaFonctionOublier
    | { [key: string]: (...args: unknown[]) => void }
  > {
    const f = args[nomArgFonction] as types.schémaFonctionSuivi<unknown>;
    const argsSansF = Object.fromEntries(
      Object.entries(args).filter((x) => typeof x[1] !== "function"),
    );
    if (f === undefined) {
      this.erreur({
        code: ERREUR_FONCTION_MANQUANTE,
        erreur:
          "Aucun argument de nom " +
          nomArgFonction +
          " n'a été donnée pour " +
          fonction.join("."),
        id,
      });
    }
    if (Object.keys(args).length > Object.keys(argsSansF).length + 1) {
      this.erreur({
        code: ERREUR_MULTIPLES_FONCTIONS,
        erreur:
          "Plus d'un argument pour " +
          fonction.join(".") +
          " est une fonction : " +
          JSON.stringify(args),
        id,
      });
    } else if (typeof f !== "function") {
      this.erreur({
        code: ERREUR_PAS_UNE_FONCTION,
        erreur: "Argument " + nomArgFonction + "n'est pas une fonction : ",
        id,
      });
    }

    const message: MessageSuivrePourIpa = {
      type: "suivre",
      id,
      fonction,
      args: argsSansF,
      nomArgFonction,
    };

    const fRetour = async (fonction: string, args?: unknown[]) => {
      const messageRetour: MessageRetourPourIpa = {
        type: "retour",
        id,
        fonction,
        args,
      };
      this.envoyerMessageÀIpa(messageRetour);
    };

    const tâche: Tâche = {
      id,
      fSuivre: f,
      fRetour,
    };
    this.tâches[id] = tâche;

    const fOublierTâche = async () => {
      await this.oublierTâche(id);
    };

    this.envoyerMessageÀIpa(message);

    const retour = await lorsque(this.événementsInternes, id);

    if (retour.type === "erreur") {
      this.erreur({
        erreur: retour.erreur,
        id,
        code: retour.codeErreur || ERREUR_EXÉCUTION_IPA,
      });
    }

    if (retour.type === "suivrePrêt") {
      const { fonctions } = retour;
      if (fonctions && fonctions[0]) {
        const retour: { [key: string]: (...args: unknown[]) => Promise<void> } =
          {
            fOublier: fOublierTâche,
          };
        for (const f of fonctions) {
          retour[f] = async (...args: unknown[]) => {
            await this.tâches[id]?.fRetour(f, args);
          };
        }
        return retour;
      }
    }
    return fOublierTâche;
  }

  async appelerFonctionAction<T>(
    id: string,
    fonction: string[],
    args: { [key: string]: unknown },
  ): Promise<T> {
    const message: MessageActionPourIpa = {
      type: "action",
      id,
      fonction,
      args: args,
    };

    const promesse = new Promise<T>((résoudre, rejeter) => {
      lorsque(this.événementsInternes, id).then((retour) => {
        if (retour.type === "erreur") rejeter(new Error(retour.erreur));
        else if (retour.type === "action") résoudre(retour.résultat as T);
      });
    });

    this.envoyerMessageÀIpa(message);

    return promesse;
  }

  erreur({
    erreur,
    code,
    id,
  }: {
    erreur: string;
    code: string;
    id?: string;
  }): void {
    // Si l'IPA n'a pas bien été initialisée, toutes les autres erreurs sont pas très importantes
    if (
      this.dernièreErreur?.code !== ERREUR_INIT_IPA &&
      this.dernièreErreur?.code !== ERREUR_INIT_IPA_DÉJÀ_LANCÉ
    ) {
      this.dernièreErreur = { erreur, id, code };
    }
    this.événements.emit("erreur", this.dernièreErreur);
    throw new Error(JSON.stringify(this.dernièreErreur));
  }

  async oublierTâche(id: string): Promise<void> {
    const tâche = this.tâches[id];
    if (tâche) await tâche.fRetour("fOublier");
    delete this.tâches[id];
  }

  abstract envoyerMessageÀIpa(message: MessagePourIpa): void;

  async recevoirMessageDIpa(message: MessageDIpa): Promise<void> {
    const { type } = message;
    switch (type) {
      case "suivre": {
        const { id, données } = message;
        if (!this.tâches[id]) return;
        const { fSuivre } = this.tâches[id];
        fSuivre(données);
        break;
      }
      case "action":
      case "suivrePrêt":
      case "erreur": {
        if (message.type === "erreur" && !message.id) {
          this.erreur({
            erreur: message.erreur,
            code: message.erreur || ERREUR_EXÉCUTION_IPA,
          });
          break;
        }
        this.événementsInternes.emit(message.id!, message);
        break;
      }
      default: {
        this.erreur({
          code: ERREUR_MESSAGE_INCONNU,
          erreur: `Type inconnu ${type} du message ${message}.`,
          id: (message as MessageDIpa).id,
        });
      }
    }
  }

  // Fonctions publiques
  suivreErreurs({ f }: { f: (x: ErreurMandataire | undefined) => void }) {
    this.événements.on("erreur", f);
    f(this.dernièreErreur);
    return () => this.événements.off("erreur", f);
  }
}

class Handler {
  listeAtributs: string[];

  constructor(listeAtributs?: string[]) {
    this.listeAtributs = listeAtributs || [];
  }

  get(obj: Mandatairifiable, prop: string): unknown {
    const directes = ["suivreErreurs"];
    if (directes.includes(prop)) {
      return obj[prop as keyof Mandatairifiable].bind(obj);
    } else {
      const listeAtributs = [...this.listeAtributs, prop];
      const h = new Handler(listeAtributs);
      return new Proxy(obj, h);
    }
  }

  apply(
    target: Mandatairifiable,
    _thisArg: Handler,
    args: [{ [key: string]: unknown }],
  ) {
    return target.__call__(this.listeAtributs, args[0]);
  }
}

export type MandataireConstellation<T> = Required<T> & Mandatairifiable;

export const générerMandataire = <T>(
  mandataireClient: Mandatairifiable,
): MandataireConstellation<T> => {
  const handler = new Handler();
  return new Proxy<Mandatairifiable>(
    mandataireClient,
    handler,
  ) as MandataireConstellation<T>;
};
