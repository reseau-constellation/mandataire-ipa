import { client, utils, mandataire, utilsTests } from "@constl/ipa";
import {
  générerMandataire,
  ClientMandatairifiable,
  MandataireClientConstellation,
} from "@/mandataire.js";

import { join, sep } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { rimraf } from "rimraf";

import { expect, chai, chaiAsPromised } from "aegir/chai";
chai.use(chaiAsPromised);

class Mandataire extends ClientMandatairifiable {
  gestionnaireClient: mandataire.gestionnaireClient.default;
  constructor({ opts }: { opts: client.optsConstellation }) {
    super();
    this.gestionnaireClient = new mandataire.gestionnaireClient.default(
      (m: mandataire.messages.MessageDeTravailleur) =>
        this.événements.emit("message", m),
      (e: string, idRequète?: string) =>
        this.événements.emit("message", {
          type: "erreur",
          erreur: e,
          id: idRequète,
        }),
      opts
    );
  }

  envoyerMessage(message: mandataire.messages.MessagePourTravailleur): void {
    this.gestionnaireClient.gérerMessage(message);
  }
}

describe("Mandataire", () => {
  let mnd: MandataireClientConstellation;
  let fOublierConstellation: utils.schémaFonctionOublier;

  const attendreNoms = new utilsTests.attente.AttendreRésultat<{
    [clef: string]: string;
  }>();
  const attendreMC = new utilsTests.attente.AttendreRésultat<
    utils.résultatRecherche<utils.infoRésultatTexte>[]
  >();

  before(async () => {
    const dirTemp = mkdtempSync(`${tmpdir()}${sep}`);

    const dossierSFIP = join(dirTemp, "sfip");
    const dsfip = await utilsTests.sfip.initierSFIP(dossierSFIP);

    mnd = générerMandataire(
      new Mandataire({
        opts: {
          orbite: {
            dossier: join(dirTemp, "orbite"),
            sfip: { sfip: dsfip },
          },
        },
      })
    );
    fOublierConstellation = async () => {
      await mnd.fermer();
      await utilsTests.sfip.arrêterSFIP(dsfip);
      rimraf.sync(dirTemp);
    };
  });

  after(async () => {
    attendreNoms.toutAnnuler();
    attendreMC.toutAnnuler();
    if (fOublierConstellation) await fOublierConstellation();
  });

  it("Action", async () => {
    const idCompte = await mnd.obtIdCompte();
    expect(utils.adresseOrbiteValide(idCompte)).to.be.true();
  });

  it("Action avec arguments", async () => {
    const idVariable = await mnd.variables.créerVariable({
      catégorie: "audio",
    });
    expect(utils.adresseOrbiteValide(idVariable)).to.be.true();
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
      (x) => Object.keys(x).length > 0
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
      await mnd.recherche.rechercherMotClefSelonNom({
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
      (x) => x.length > 0 && x[0].id === idMotClef2
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
    return expect(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error  on fait exprès
      mnd.jeNeSuisPasUneFonction()
    ).to.be.rejectedWith(
      Error,
      "Fonction ClientConstellation.jeNeSuisPasUneFonction n'existe pas ou n'est pas une fonction."
    );
  });

  it("Erreur action inexistante", async () => {
    expect(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error  on fait exprès
      mnd.jeNeSuisPasUnAtribut.ouUneFonction()
    ).to.be.rejectedWith(
      Error,
      "Fonction ClientConstellation.jeNeSuisPasUnAtribut.ouUneFonction() n'existe pas ou n'est pas une fonction."
    );
  });

  it("Erreur suivi trop de fonctions", async () => {
    expect(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error  on fait exprès
      mnd.profil.suivreNoms({ f: utils.faisRien, f2: utils.faisRien })
    ).to.be.rejectedWith(Error, "abc");
  });
  it("Erreur format paramètres", async () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      mnd.profil.suivreNoms(utils.faisRien)
    ).to.throw();
  });
});
