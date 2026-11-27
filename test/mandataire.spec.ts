import { faisRien } from "@constl/utils-ipa";
import { isValidAddress } from "@orbitdb/core";
import {
  générerMandataire,
  Mandatairifiable,
  type MandataireConstellation,
  type ErreurMandataire,
  type MessageDIpa,
  type MessagePourIpa,
} from "../src/index.ts";
import { expect, chai, chaiAsPromised } from "aegir/chai";
// @ts-expect-error Pour l'instant...
import { Constellation, type OptionsConstellation } from "@constl/ipa";
import { EnveloppeAppli } from "../src/enveloppe.ts";
import {
  créerHéliasTest,
  dossierTempo,
  obtenir,
  rechercher,
  type ServicesLibp2pTest,
} from "@constl/utils-tests";
import type { Oublier } from "@constl/interface";
import type { TraducsTexte } from "./types.ts";
import { type HeliaWithLibp2p } from "@helia/libp2p";
import type { InfoRésultatTexte } from "@constl/interface/recherche";

chai.use(chaiAsPromised);

class Mandataire extends Mandatairifiable {
  ipa: EnveloppeAppli;
  constructor(options: OptionsConstellation) {
    super();
    this.ipa = new EnveloppeAppli(
      (m: MessageDIpa) => {
        this.recevoirMessageDIpa(m);
      },
      (e: ErreurMandataire) => {
        this.recevoirMessageDIpa({
          type: "erreur",
          erreur: e.erreur,
          codeErreur: e.code,
          idRequête: e.idRequête,
        });
      },
      () => new Constellation(options),
    );
  }

  envoyerMessageÀIpa(message: MessagePourIpa): void {
    this.ipa.gérerMessage(message);
  }
}

describe("Mandataire Constellation", () => {
  let mnd: MandataireConstellation<Constellation>;
  let hélias: HeliaWithLibp2p<ServicesLibp2pTest>[];
  let dossier: string;
  let fermerHélias: Oublier;
  let effacer: () => void;

  before(async () => {
    ({ hélias, fermer: fermerHélias } = await créerHéliasTest({ n: 1 }));

    ({ dossier, effacer } = await dossierTempo());

    mnd = générerMandataire(
      new Mandataire({
        services: {
          dossier: { dossier },
          hélia: { hélia: hélias[0] },
        },
      }),
    );
  });

  after(async () => {
    await mnd?.fermer();
    await fermerHélias?.();
    effacer?.();
  });

  it("action", async () => {
    const idCompte = await mnd.compte.obtIdCompte();
    expect(
      isValidAddress(idCompte.replace("/nébuleuse/compte", "")),
    ).to.be.true();
  });

  it("action avec arguments", async () => {
    const idVariable = await mnd.variables.créerVariable({
      catégorie: "audio",
    });
    expect(
      isValidAddress(idVariable.replace("/constl/variables", "")),
    ).to.be.true();
  });

  it("suivi", async () => {
    const noms = await obtenir<TraducsTexte>(({ siDéfini }) =>
      mnd.profil.suivreNoms({
        f: siDéfini(),
      }),
    );
    expect(noms).to.deep.equal({});

    await mnd.profil.sauvegarderNom({
      langue: "fr",
      nom: "Julien Jean Malard-Adam",
    });
    const val2 = await obtenir<TraducsTexte>(({ si }) =>
      mnd.profil.suivreNoms({
        f: si((x) => {
          return !!x && Object.keys(x).length > 0;
        }),
      }),
    );
    expect(val2).to.deep.equal({ fr: "Julien Jean Malard-Adam" });
  });

  it("recherche", async () => {
    // Eléments détectés
    const recherche = await rechercher<InfoRésultatTexte>(({ f }) =>
      mnd.motsClefs.recherche.selonNom({
        nomMotClef: "Météo Montréal",
        f,
      }),
    );

    const idMotClef1 = await mnd.motsClefs.créerMotClef();
    await mnd.motsClefs.sauvegarderNoms({
      idMotClef: idMotClef1,
      noms: { fr: "Météo à Montréal" },
    });

    const idMotClef2 = await mnd.motsClefs.créerMotClef();
    await mnd.motsClefs.sauvegarderNoms({
      idMotClef: idMotClef2,
      noms: { fr: "Météo Montréal" },
    });

    const motsClefs = await recherche.siAuMoins(2);
    expect(motsClefs.map((r) => r.id)).to.have.deep.members([
      idMotClef1,
      idMotClef2,
    ]);

    // Diminuer N résultats désirés
    await recherche.n(1);
    const nomsNDiminué = await recherche.siPasPlusQue(1);
    expect(nomsNDiminué.map((r) => r.id)).to.have.deep.members([idMotClef2]);

    // Augmenter N
    await recherche.n(2);
    const nomsNAugementé = await recherche.siAuMoins(2);
    expect(nomsNAugementé.map((r) => r.id)).to.have.deep.members([
      idMotClef1,
      idMotClef2,
    ]);
  });

  it("erreur fonction suivi inexistante", async () => {
    await expect(
      // @ts-expect-error on fait exprès
      mnd.jeNeSuisPasUneFonction(),
    ).to.be.rejectedWith("n'existe pas ou n'est pas une fonction");
  });

  it("erreur action inexistante", async () => {
    await expect(
      // @ts-expect-error on fait exprès
      mnd.jeNeSuisPasUnAtribut.ouUneFonction(),
    ).to.be.rejectedWith("n'existe pas ou n'est pas une fonction");
  });

  it("erreur suivi trop de fonctions", async () => {
    await expect(
      // @ts-expect-error on fait exprès
      mnd.profil.suivreNoms({ f: faisRien, f2: faisRien }),
    ).to.be.rejectedWith("Plus d'un argument pour");
  });

  it("erreur suivi sans fonction", async () => {
    await expect(
      // @ts-expect-error on fait exprès
      mnd.profil.suivreNoms({}),
    ).to.be.rejectedWith(
      "Aucun argument pour Profil.suivreNoms n'est une fonction",
    );
  });

  it("erreur suivi fonction n'est pas une fonction", async () => {
    await expect(
      // @ts-expect-error on fait exprès
      mnd.profil.suivreNoms({ f: 123 }),
    ).to.be.rejectedWith(
      "Aucun argument pour Profil.suivreNoms n'est une fonction",
    );
  });

  it("erreur format paramètres", async () => {
    expect(() =>
      // @ts-expect-error on fait exprès
      mnd.profil.suivreNoms(faisRien),
    ).to.throw(
      "doit être appelée avec un seul argument en format d'objet (dictionnaire)",
    );
  });

  it("erreur interne dans suivi", async () => {
    const suivi = mnd.profil.suivreNoms({
      f: faisRien,
      // @ts-expect-error On fait exprès...
      idCompte: 123,
    });
    await expect(suivi).to.be.rejectedWith(
      "TypeError: id.split is not a function",
    );
  });

  it("erreur interne dans action", async () => {
    await expect(
      mnd.bds.ajouterMotsClefs({
        idBd: "je ne suis pas une adresse bd valide",
        idsMotsClefs: [],
      }),
    ).to.be.rejectedWith(
      "L'identifiant je ne suis pas une adresse bd valide n'est pas un identifiant valide pour bds",
    );
  });
});
