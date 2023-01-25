import { client, utils, mandataire, utilsTests } from "@constl/ipa";
import {
  générerMandataire,
  ClientMandatairifiable,
  MandataireClientConstellation,
} from "@/mandataire.js";

import { join, sep } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import rimraf from "rimraf";

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

  const attendreNoms = new utilsTests.AttendreRésultat<{
    [clef: string]: string;
  }>();
  const attendreMC = new utilsTests.AttendreRésultat<
    utils.résultatRecherche<utils.infoRésultatTexte>[]
  >();

  beforeAll(async () => {
    const dirTemp = mkdtempSync(`${tmpdir()}${sep}`);

    const dossierSFIP = join(dirTemp, "sfip");
    const dsfip = await utilsTests.initierSFIP(dossierSFIP);

    mnd = générerMandataire(
      new Mandataire({
        opts: {
          orbite: {
            dossier: join(dirTemp, "orbite"),
            sfip: { sfip: dsfip.api },
          },
        },
      })
    );
    fOublierConstellation = async () => {
      await mnd.fermer();
      await utilsTests.arrêterSFIP(dsfip);
      rimraf.sync(dirTemp);
    };
  });

  afterAll(async () => {
    attendreNoms.toutAnnuler();
    attendreMC.toutAnnuler();
    if (fOublierConstellation) await fOublierConstellation();
  });

  test("Action", async () => {
    const idCompte = await mnd.obtIdCompte();
    expect(utils.adresseOrbiteValide(idCompte)).toBeTruthy();
  });

  test("Action avec arguments", async () => {
    const idVariable = await mnd.variables.créerVariable({
      catégorie: "audio",
    });
    expect(utils.adresseOrbiteValide(idVariable)).toBeTruthy();
  });

  test("Suivi", async () => {
    const oublierNoms = await mnd.profil!.suivreNoms({
      f: (n) => attendreNoms.mettreÀJour(n),
    });

    const val = await attendreNoms.attendreExiste();
    expect(Object.keys(val)).toHaveLength(0);

    await mnd.profil!.sauvegarderNom({
      langue: "fr",
      nom: "Julien Jean Malard-Adam",
    });
    const val2 = await attendreNoms.attendreQue(
      (x) => Object.keys(x).length > 0
    );
    expect(val2).toEqual({ fr: "Julien Jean Malard-Adam" });

    await oublierNoms();

    await mnd.profil!.sauvegarderNom({
      langue: "es",
      nom: "Julien Jean Malard-Adam",
    });
    expect(attendreNoms.val).toEqual({ fr: "Julien Jean Malard-Adam" });
  });

  test("Recherche", async () => {
    // Eléments détectés
    const { fOublier, fChangerN } =
      await mnd.recherche.rechercherMotClefSelonNom({
        nomMotClef: "Météo Montréal",
        f: (x) => attendreMC.mettreÀJour(x),
        nRésultatsDésirés: 1,
      });

    const idMotClef1 = await mnd.motsClefs.créerMotClef();
    await mnd.motsClefs.ajouterNomsMotClef({
      id: idMotClef1,
      noms: { fr: "Météo à Montréal" },
    });

    const idMotClef2 = await mnd.motsClefs.créerMotClef();
    await mnd.motsClefs.ajouterNomsMotClef({
      id: idMotClef2,
      noms: { fr: "Météo Montréal" },
    });

    const val = await attendreMC.attendreQue(
      (x) => x.length > 0 && x[0].id === idMotClef2
    );
    expect(val.map((r) => r.id)).toEqual(expect.arrayContaining([idMotClef2]));

    // Augmenter N résultats désirés
    await fChangerN(2);
    const val2 = await attendreMC.attendreQue((x) => x.length > 1);
    expect(val2.map((r) => r.id)).toEqual(
      expect.arrayContaining([idMotClef1, idMotClef2])
    );

    // Diminuer N
    await fChangerN(1);
    const val3 = await attendreMC.attendreQue((x) => x.length <= 1);
    expect(val3.map((r) => r.id)).toEqual(expect.arrayContaining([idMotClef2]));

    await fOublier();
  });

  test("Erreur fonction suivi inexistante", async () => {
    await expect(() =>
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      mnd.jeNeSuisPasUneFonction()
    ).rejects.toThrow();
  });

  test("Erreur action inexistante", async () => {
    await expect(() =>
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      mnd.jeNeSuisPasUnAtribut.ouUneFonction()
    ).rejects.toThrow();
  });

  test("Erreur suivi trop de fonctions", async () => {
    await expect(() =>
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      mnd.profil.suivreNoms({ f: utils.faisRien, f2: utils.faisRien })
    ).rejects.toThrow();
  });
  test("Erreur format paramètres", async () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      mnd.profil.suivreNoms(utils.faisRien)
    ).toThrowError();
  });
});
