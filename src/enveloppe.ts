import { Semaphore } from "@chriscdn/promise-semaphore";
import { v4 as uuidv4 } from "uuid";
import type { Appli } from "@constl/ipa";
import type { Oublier } from "@constl/interface";
import type {
  MessageActionDIpa,
  MessageConfirmationRéceptionRetourDIpa,
  MessageDIpa,
  MessagePourIpa,
  MessageSuivreDIpa,
  MessageSuivrePrêtDIpa,
} from "./messages.ts";
import type { ErreurMandataire } from "./mandataire.ts";
import {
  ERREUR_EXÉCUTION_IPA,
  ERREUR_FONCTION_MANQUANTE,
  ERREUR_INIT_IPA,
  ERREUR_PAS_UNE_FONCTION,
} from "./codes.ts";

export class EnveloppeAppli<T extends Appli = Appli> {
  appli?: T;
  créerAppli: () => T;

  erreurInitialisation?: Error;
  _messagesEnAttente: MessagePourIpa[];
  prêt: boolean;
  dicFRetourSuivi: {
    [key: string]: { fOublier: Oublier } & {
      [key: string]: (...args: unknown[]) => Promise<void>;
    };
  };

  fsMessages: { [clef: string]: (m: MessageDIpa) => void };
  fsErreurs: {
    [clef: string]: (e: ErreurMandataire) => void;
  };

  _verrou: Semaphore;

  constructor(
    fMessage: (m: MessageDIpa) => void,
    fErreur: (args: ErreurMandataire) => void,
    créerAppli: () => T,
  ) {
    this.fsMessages = {};
    this.fsErreurs = {};

    this.connecterÉcouteurs({
      fMessage,
      fErreur,
    });

    this.créerAppli = créerAppli;

    this.dicFRetourSuivi = {};

    this.prêt = false;
    this._messagesEnAttente = [];
    this._verrou = new Semaphore();

    this.init();
  }

  fMessage(m: MessageDIpa) {
    Object.values(this.fsMessages).forEach((f) => f(m));
  }

  fErreur({
    erreur,
    idRequête,
    code,
  }: {
    erreur: string;
    idRequête?: string;
    code: string;
  }) {
    Object.values(this.fsErreurs).forEach((f) =>
      f({ erreur, idRequête, code }),
    );
  }

  async init(): Promise<T> {
    await this._verrou.acquire("init");

    if (this.appli) {
      this._verrou.release("init");
      return this.appli;
    } // Nécessaire si on a plus qu'un mandataire connecté à la même instance Nébuleuse

    try {
      this.appli = await this.créerAppli();
      await this.appli!.démarrer();

      this._messagesEnAttente.forEach((m) => this._gérerMessage(m)); // À faire: syncroniser
      this.prêt = true;
    } catch (e) {
      const erreur = e as Error;
      this.erreurInitialisation = erreur;
      this.fErreur({
        erreur: erreur.toString() + erreur.stack,
        code: erreur.name === "Error" ? ERREUR_INIT_IPA : erreur.name,
      });

      // Aussi renvoyer l'erreur à toutes les requêtes potentiellement en attente de l'initialisation.
      this._messagesEnAttente.forEach((m) =>
        this.fErreur({
          erreur: (e as Error).toString() + (e as Error).stack,
          idRequête: m.idRequête,
          code:
            (e as Error).name === "Error" ? ERREUR_INIT_IPA : (e as Error).name,
        }),
      );

      throw e;
    } finally {
      this._verrou.release("init");
    }

    return this.appli!;
  }

  async gérerMessage(message: MessagePourIpa): Promise<void> {
    if (this.prêt) {
      await this._gérerMessage(message);
    } else if (this.erreurInitialisation) {
      this.fErreur({
        erreur:
          this.erreurInitialisation.toString() +
          this.erreurInitialisation.stack,
        idRequête: message.idRequête,
        code:
          this.erreurInitialisation.name === "Error"
            ? ERREUR_INIT_IPA
            : this.erreurInitialisation.name,
      });
    } else {
      this._messagesEnAttente.unshift(message);
    }
  }

  async _gérerMessage(message: MessagePourIpa): Promise<void> {
    if (!this.appli) {
      this.fErreur({
        erreur: "IPA non initialisé",
        idRequête: message.idRequête,
        code: ERREUR_INIT_IPA,
      });
      return;
    }

    const { type } = message;
    switch (type) {
      case "suivre": {
        const { idRequête, fonction, args, nomArgFonction } = message;

        const fonctionIPA = this.extraireFonctionNébuleuse(fonction, idRequête);
        if (!fonctionIPA) return; // L'erreur est déjà envoyée par extraireFonctionNébuleuse

        const fFinale = (données: unknown) => {
          const messageRetour: MessageSuivreDIpa = {
            type: "suivre",
            idRequête,
            données,
          };
          this.fMessage(messageRetour);
        };

        args[nomArgFonction] = fFinale;

        try {
          const retour = (await fonctionIPA(args)) as
            | Oublier
            | {
                fOublier: Oublier;
                [key: string]: (...args: unknown[]) => Promise<void>;
              };
          const retourFinal =
            typeof retour === "function" ? { fOublier: retour } : retour;

          this.dicFRetourSuivi[idRequête] = retourFinal;
          const messageRetour: MessageSuivrePrêtDIpa = {
            type: "suivrePrêt",
            idRequête,
          };
          if (typeof retour !== "function")
            messageRetour.fonctions = Object.keys(retour);
          this.fMessage(messageRetour);
        } catch (er) {
          const texteErreur = (er instanceof AggregateError ? er.errors : [er])
            .map((e) => e.toString() + e.stack.toString())
            .join("\n");
          this.fErreur({
            erreur: texteErreur,
            idRequête,
            code: ERREUR_EXÉCUTION_IPA,
          });
        }

        break;
      }
      case "action": {
        const { idRequête, fonction, args } = message;

        const fonctionIPA = this.extraireFonctionNébuleuse(fonction, idRequête);
        if (!fonctionIPA) return; // L'erreur est déjà envoyée par extraireFonctionNébuleuse

        try {
          const résultat = await fonctionIPA(args);
          const messageRetour: MessageActionDIpa = {
            type: "action",
            idRequête,
            résultat,
          };
          this.fMessage(messageRetour);
        } catch (er) {
          const texteErreur = (er instanceof AggregateError ? er.errors : [er])
            .map((e) => e.toString() + e.stack.toString())
            .join("\n");
          this.fErreur({
            erreur: texteErreur,
            idRequête,
            code: ERREUR_EXÉCUTION_IPA,
          });
        }

        break;
      }
      case "retour": {
        const { idRequête, idRetour, fonction, args } = message;
        const retour = this.dicFRetourSuivi[idRequête];

        if (fonction === "fOublier") delete this.dicFRetourSuivi[idRequête];
        if (retour) {
          try {
            await retour[fonction](args);
            const messageRéponse: MessageConfirmationRéceptionRetourDIpa = {
              type: "confirmation",
              idRequête,
              idRetour,
            };
            this.fMessage(messageRéponse);
          } catch (e) {
            this.fErreur({
              erreur:
                (e as Error).toString() +
                ((e as Error).stack?.toString() || ""),
              idRequête: idRetour,
              code: ERREUR_EXÉCUTION_IPA,
            });
          }
        }

        break;
      }
      default: {
        this.fErreur({
          erreur: `Type de requête ${type} non reconnu dans message ${message}`,
          idRequête: (message as MessagePourIpa).idRequête,
          code: ERREUR_EXÉCUTION_IPA,
        });
        break;
      }
    }
  }

  extraireFonctionNébuleuse<A>(
    adresseFonction: string[],
    idMessage: string,
  ): ((...args: A[]) => unknown) | undefined {
    const erreur = `Fonction Constellation.${adresseFonction.join(
      ".",
    )} n'existe pas ou n'est pas une fonction.`;

    type N = T;
    let fonctionNébuleuse:
      | N
      | N[keyof N]
      | ((args: { [key: string]: unknown }) => Promise<unknown>) = this.appli!;

    for (const [i, attr] of adresseFonction.entries()) {
      if (
        typeof fonctionNébuleuse === "object" &&
        attr in fonctionNébuleuse &&
        fonctionNébuleuse[attr as keyof typeof fonctionNébuleuse]
      ) {
        // Vive JavaScript et `this`!
        if (i === adresseFonction.length - 1) {
          // @ts-expect-error Ça, ça me dépasse
          fonctionNébuleuse = fonctionNébuleuse[attr].bind(fonctionNébuleuse);
        } else {
          // @ts-expect-error Ça, ça me dépasse
          fonctionNébuleuse =
            fonctionNébuleuse[attr as keyof typeof fonctionNébuleuse];
        }
      } else {
        this.fErreur({
          erreur,
          idRequête: idMessage,
          code: ERREUR_FONCTION_MANQUANTE,
        });
        return undefined;
      }

      if (!fonctionNébuleuse) {
        this.fErreur({
          erreur,
          idRequête: idMessage,
          code: ERREUR_FONCTION_MANQUANTE,
        });
        return undefined;
      }
    }
    if (typeof fonctionNébuleuse !== "function") {
      this.fErreur({
        erreur,
        idRequête: idMessage,
        code: ERREUR_PAS_UNE_FONCTION,
      });
      return undefined;
    }
    return fonctionNébuleuse as (...args: A[]) => unknown;
  }

  connecterÉcouteurs({
    fMessage,
    fErreur,
  }: {
    fMessage: (m: MessageDIpa) => void;
    fErreur: (e: ErreurMandataire) => void;
  }): () => void {
    const idÉcouteurs = uuidv4();
    this.fsMessages[idÉcouteurs] = fMessage;
    this.fsErreurs[idÉcouteurs] = fErreur;
    return () => {
      delete this.fsMessages[idÉcouteurs];
      delete this.fsErreurs[idÉcouteurs];
    };
  }

  async fermer(): Promise<void> {
    // Avant de fermer, il faut être sûr qu'on a bien initialisé !
    const ipa = await this.init();
    await ipa.fermer();
  }
}
