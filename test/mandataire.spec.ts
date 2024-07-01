import type { MessageDIpa, MessagePourIpa } from "@/messages.js";

import { client, types, mandataire } from "@constl/ipa";
import { faisRien } from "@constl/utils-ipa";
import { attente, sfip } from "@constl/utils-tests";
import { isValidAddress } from "@orbitdb/core";
import {
  générerMandataire,
  Mandatairifiable,
  MandataireConstellation,
} from "@/mandataire.js";

import { isNode, isElectronMain } from "wherearewe";

import { expect, chai, chaiAsPromised } from "aegir/chai";
chai.use(chaiAsPromised);

class Mandataire extends Mandatairifiable {
  gestionnaireClient: mandataire.gestionnaireClient.GestionnaireClient;
  constructor({ opts }: { opts: client.optsConstellation }) {
    super();
    this.gestionnaireClient =
      new mandataire.gestionnaireClient.GestionnaireClient(
        (m: MessageDIpa) => this.événements.emit("message", m),
        (e: string, idRequète?: string) =>
          this.événements.emit("message", {
            type: "erreur",
            erreur: e,
            id: idRequète,
          }),
        opts,
      );
  }

  envoyerMessageÀIpa(message: MessagePourIpa): void {
    this.gestionnaireClient.gérerMessage(message);
  }
}

describe("Mandataire Constellation", () => {
  let mnd: MandataireConstellation<client.ClientConstellation>;
  let fOublierConstellation: types.schémaFonctionOublier;

  const attendreNoms = new attente.AttendreRésultat<{
    [clef: string]: string;
  }>();
  const attendreMC = new attente.AttendreRésultat<
    types.résultatRecherche<types.infoRésultatTexte>[]
  >();

  before(async () => {
    let dossierTempo: string | undefined = undefined;
    let dossierSFIP: string | undefined = undefined;

    if (isNode || isElectronMain) {
      const fs = await import("fs");
      const path = await import("path");
      const os = await import("os");
      dossierTempo = fs.mkdtempSync(path.join(os.tmpdir(), "constl-ipa"));
      dossierSFIP = path.join(dossierTempo, "sfip");
    }

    const sfip1 = await sfip.créerHéliaTest({ dossier: dossierSFIP });

    mnd = générerMandataire(
      new Mandataire({
        opts: {
          dossier: dossierTempo,
          orbite: {
            ipfs: sfip1,
          },
        },
      }),
    );
    fOublierConstellation = async () => {
      await mnd.fermer();
      await sfip1.stop();
      if (isNode || isElectronMain) {
        const rimraf = await import("rimraf");
        rimraf.sync(dossierTempo);
      }
    };
  });

  after(async () => {
    attendreNoms.toutAnnuler();
    attendreMC.toutAnnuler();
    if (fOublierConstellation) await fOublierConstellation();
  });

  it("Action", async () => {
    const idCompte = await mnd.obtIdCompte();
    expect(isValidAddress(idCompte)).to.be.true();
  });

  it("Action avec arguments", async () => {
    const idVariable = await mnd.variables.créerVariable({
      catégorie: "audio",
    });
    expect(isValidAddress(idVariable)).to.be.true();
  });

  it("Suivi", async () => {
    const oublierNoms = await mnd.profil!.suivreNoms({
      f: (n) => attendreNoms.mettreÀJour(n),
    });

    const val = await attendreNoms.attendreExiste();
    expect(Object.keys(val).length).to.eq(0);

    await mnd.profil!.sauvegarderNom({
      langue: "fr",
      nom: "Julien Jean Malard-Adam",
    });
    const val2 = await attendreNoms.attendreQue(
      (x) => Object.keys(x).length > 0,
    );
    expect(val2).to.deep.equal({ fr: "Julien Jean Malard-Adam" });

    await oublierNoms();

    await mnd.profil!.sauvegarderNom({
      langue: "es",
      nom: "Julien Jean Malard-Adam",
    });
    expect(attendreNoms.val).to.deep.equal({ fr: "Julien Jean Malard-Adam" });
  });

  it("Recherche", async () => {
    // Eléments détectés
    const { fOublier, fChangerN } =
      await mnd.recherche.rechercherMotsClefsSelonNom({
        nomMotClef: "Météo Montréal",
        f: (x) => attendreMC.mettreÀJour(x),
        nRésultatsDésirés: 1,
      });

    const idMotClef1 = await mnd.motsClefs.créerMotClef();
    await mnd.motsClefs.sauvegarderNomsMotClef({
      idMotClef: idMotClef1,
      noms: { fr: "Météo à Montréal" },
    });

    const idMotClef2 = await mnd.motsClefs.créerMotClef();
    await mnd.motsClefs.sauvegarderNomsMotClef({
      idMotClef: idMotClef2,
      noms: { fr: "Météo Montréal" },
    });

    const val = await attendreMC.attendreQue(
      (x) => x.length > 0 && x[0].id === idMotClef2,
    );
    expect(val.map((r) => r.id)).to.deep.equal([idMotClef2]);

    // Augmenter N résultats désirés
    await fChangerN(2);
    const val2 = await attendreMC.attendreQue((x) => x.length > 1);
    expect(val2.map((r) => r.id)).to.have.members([idMotClef1, idMotClef2]);

    // Diminuer N
    await fChangerN(1);
    const val3 = await attendreMC.attendreQue((x) => x.length <= 1);
    expect(val3.map((r) => r.id)).to.deep.equal([idMotClef2]);

    await fOublier();
  });

  it("Erreur fonction suivi inexistante", async () => {
    await expect(
      // @ts-expect-error on fait exprès
      mnd.jeNeSuisPasUneFonction(),
    ).to.be.rejectedWith("n'existe pas ou n'est pas une fonction");
  });

  it("Erreur action inexistante", async () => {
    await expect(
      // @ts-expect-error on fait exprès
      mnd.jeNeSuisPasUnAtribut.ouUneFonction(),
    ).to.be.rejectedWith("n'existe pas ou n'est pas une fonction");
  });

  it("Erreur suivi trop de fonctions", async () => {
    await expect(
      // @ts-expect-error on fait exprès
      mnd.profil.suivreNoms({ f: faisRien, f2: faisRien }),
    ).to.be.rejectedWith("Plus d'un argument pour");
  });

  it("Erreur suivi sans fonction", async () => {
    await expect(
      // @ts-expect-error on fait exprès
      mnd.profil.suivreNoms({}),
    ).to.be.rejectedWith("Aucun argument n'est une fonction");
  });

  it("Erreur suivi fonction n'est pas une fonction", async () => {
    await expect(
      // @ts-expect-error on fait exprès
      mnd.profil.suivreNoms({ f: 123 }),
    ).to.be.rejectedWith("Aucun argument n'est une fonction");
  });

  it("Erreur format paramètres", async () => {
    expect(() =>
      // @ts-expect-error on fait exprès
      mnd.profil.suivreNoms(faisRien),
    ).to.throw(
      "doit être appelée avec un seul argument en format d'objet (dictionnaire)",
    );
  });
});
