export type MessageDIpa =
  | MessageSuivreDIpa
  | MessageSuivrePrêtDIpa
  | MessageActionDIpa
  | MessageErreurDIpa;

export interface MessageSuivreDIpa {
  type: "suivre";
  idRequête: string;
  données: unknown;
}

export interface MessageSuivrePrêtDIpa {
  type: "suivrePrêt";
  idRequête: string;
  fonctions?: string[];
}

export interface MessageActionDIpa {
  type: "action";
  idRequête: string;
  résultat: unknown;
}

export interface MessageErreurDIpa {
  type: "erreur";
  idRequête?: string;
  codeErreur?: string;
  erreur: string;
}

export type MessagePourIpa =
  | MessageSuivrePourIpa
  | MessageActionPourIpa
  | MessageRetourPourIpa;

export interface MessageSuivrePourIpa {
  type: "suivre";
  idRequête: string;
  fonction: string[];
  args: { [key: string]: unknown };
  nomArgFonction: string;
}

export interface MessageActionPourIpa {
  type: "action";
  idRequête: string;
  fonction: string[];
  args: { [key: string]: unknown };
}

export interface MessageRetourPourIpa {
  type: "retour";
  idRequête: string;
  fonction: string;
  args?: unknown[];
}
