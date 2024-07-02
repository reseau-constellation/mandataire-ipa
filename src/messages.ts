export type MessageDIpa =
  | MessageSuivreDIpa
  | MessageSuivrePrêtDIpa
  | MessageActionDIpa
  | MessageErreurDIpa;

export interface MessageSuivreDIpa {
  type: "suivre";
  id: string;
  données: unknown;
}

export interface MessageSuivrePrêtDIpa {
  type: "suivrePrêt";
  id: string;
  fonctions?: string[];
}

export interface MessageActionDIpa {
  type: "action";
  id: string;
  résultat: unknown;
}

export interface MessageErreurDIpa {
  type: "erreur";
  id?: string;
  codeErreur?: string;
  erreur: string;
}

export type MessagePourIpa =
  | MessageSuivrePourIpa
  | MessageActionPourIpa
  | MessageRetourPourIpa;

export interface MessageSuivrePourIpa {
  type: "suivre";
  id: string;
  fonction: string[];
  args: { [key: string]: unknown };
  nomArgFonction: string;
}

export interface MessageActionPourIpa {
  type: "action";
  id: string;
  fonction: string[];
  args: { [key: string]: unknown };
}

export interface MessageRetourPourIpa {
  type: "retour";
  id: string;
  fonction: string;
  args?: unknown[];
}
