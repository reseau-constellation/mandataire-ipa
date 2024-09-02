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
  idRequête: string;
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

export type ErreurMandataire = {
  code: string;
  erreur: string;
  idRequête?: string;
};

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
    const idRequête = uuidv4();
    const nomArgFonction = Object.entries(args).find(
      (x) => typeof x[1] === "function",
    )?.[0];

    if (nomArgFonction) {
      return this.appelerFonctionSuivre(
        idRequête,
        fonction,
        args,
        nomArgFonction,
      );
    } else {
      return this.appelerFonctionAction(idRequête, fonction, args);
    }
  }

  async appelerFonctionSuivre(
    idRequête: string,
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

    // Vérifier format paramètres
    if (f === undefined) {
      this.erreur({
        code: ERREUR_FONCTION_MANQUANTE,
        erreur:
          "Aucun argument de nom " +
          nomArgFonction +
          " n'a été donnée pour " +
          fonction.join("."),
        idRequête,
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
        idRequête,
      });
    } else if (typeof f !== "function") {
      this.erreur({
        code: ERREUR_PAS_UNE_FONCTION,
        erreur: "Argument " + nomArgFonction + "n'est pas une fonction : ",
        idRequête,
      });
    }

    const message: MessageSuivrePourIpa = {
      type: "suivre",
      idRequête,
      fonction,
      args: argsSansF,
      nomArgFonction,
    };

    const fRetour = async (fonction: string, args?: unknown[]) => {
      const messageRetour: MessageRetourPourIpa = {
        type: "retour",
        idRequête,
        fonction,
        args,
      };
      this.envoyerMessageÀIpa(messageRetour);
    };

    const tâche: Tâche = {
      idRequête,
      fSuivre: f,
      fRetour,
    };
    this.tâches[idRequête] = tâche;

    const fOublierTâche = async () => {
      await this.oublierTâche(idRequête);
    };

    const lorsqueRetour = lorsque(this.événementsInternes, idRequête);

    this.envoyerMessageÀIpa(message);

    const retour = await lorsqueRetour;

    if (retour.type === "erreur") {
      this.erreur({
        erreur: retour.erreur,
        idRequête,
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
            await this.tâches[idRequête]?.fRetour(f, args);
          };
        }
        return retour;
      }
    }
    return fOublierTâche;
  }

  async appelerFonctionAction<T>(
    idRequête: string,
    fonction: string[],
    args: { [key: string]: unknown },
  ): Promise<T> {
    const message: MessageActionPourIpa = {
      type: "action",
      idRequête,
      fonction,
      args: args,
    };

    const lorsqueRetour = lorsque(this.événementsInternes, idRequête);

    this.envoyerMessageÀIpa(message);

    const retour = await lorsqueRetour;
    if (retour.type === "action") {
      return retour.résultat as T;
    } else if (retour.type === "erreur") {
      this.erreur({
        erreur: retour.erreur,
        idRequête,
        code: retour.codeErreur || ERREUR_EXÉCUTION_IPA,
      });
    } else {
      this.erreur({
        erreur: `Type de retour ${retour} non reconnu.`,
        idRequête,
        code: ERREUR_EXÉCUTION_IPA,
      });
    }
    throw new Error("On ne devrait jamais arriver ici.");
  }

  erreur({
    erreur,
    code,
    idRequête,
  }: {
    erreur: string;
    code: string;
    idRequête?: string;
  }): void {
    // Si l'IPA n'a pas bien été initialisée, toutes les autres erreurs sont pas très importantes
    if (
      this.dernièreErreur?.code !== ERREUR_INIT_IPA &&
      this.dernièreErreur?.code !== ERREUR_INIT_IPA_DÉJÀ_LANCÉ
    ) {
      this.dernièreErreur = { erreur, idRequête, code };
    }
    this.événements.emit("erreur", { idRequête, ...this.dernièreErreur });
    throw new Error(JSON.stringify({ idRequête, ...this.dernièreErreur }));
  }

  async oublierTâche(idRequête: string): Promise<void> {
    const tâche = this.tâches[idRequête];
    if (tâche) await tâche.fRetour("fOublier");
    delete this.tâches[idRequête];
  }

  abstract envoyerMessageÀIpa(message: MessagePourIpa): void;

  async recevoirMessageDIpa(message: MessageDIpa): Promise<void> {
    const { type } = message;
    switch (type) {
      case "suivre": {
        const { idRequête, données } = message;
        if (!this.tâches[idRequête]) return;
        const { fSuivre } = this.tâches[idRequête];
        fSuivre(données);
        break;
      }
      case "action":
      case "suivrePrêt":
      case "erreur": {
        if (message.type === "erreur" && !message.idRequête) {
          this.erreur({
            erreur: message.erreur,
            code: message.erreur || ERREUR_EXÉCUTION_IPA,
          });
          break;
        }
        this.événementsInternes.emit(message.idRequête!, message);
        break;
      }
      default: {
        this.erreur({
          code: ERREUR_MESSAGE_INCONNU,
          erreur: `Type inconnu ${type} du message ${message}.`,
          idRequête: (message as MessageDIpa).idRequête,
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
    // Inscrire ici les fonctions publiques du mandataire qui ne
    // doivent pas être envoyées à Constellation
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
