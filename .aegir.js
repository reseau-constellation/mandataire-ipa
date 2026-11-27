import { générerConfigÆgir } from "@constl/utils-tests";
const générerConfigÆgirFinal = async () => {
  const configÆgir = await générerConfigÆgir({
    sujetsRelai: ["constellation._peer-discovery._p2p._pubsub"],
  });
  configÆgir.test.browser.config.buildConfig.external.push("@lassi-js/kili");
  return configÆgir;
};
export default await générerConfigÆgirFinal();
