export {
  MandataireConstellation,
  Mandatairifiable,
  générerMandataire,
  type ErreurMandataire,
} from "@/mandataire.js";
export type {
  MessageDIpa,
  MessageActionDIpa,
  MessageErreurDIpa,
  MessageSuivreDIpa,
  MessageSuivrePrêtDIpa,
  MessagePourIpa,
  MessageSuivrePourIpa,
  MessageActionPourIpa,
  MessageRetourPourIpa,
} from "@/messages.js";
export type {
  ERREUR_INIT_IPA,
  ERREUR_INIT_IPA_DÉJÀ_LANCÉ,
  ERREUR_EXÉCUTION_IPA,
  ERREUR_FONCTION_MANQUANTE,
  ERREUR_FORMAT_ARGUMENTS,
  ERREUR_MESSAGE_INCONNU,
  ERREUR_MULTIPLES_FONCTIONS,
  ERREUR_PAS_UNE_FONCTION,
} from "@/codes.js";

export { version } from "@/version.js";
