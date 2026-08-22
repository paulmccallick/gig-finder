import adp from "../../config/scout/templates/adp.v1.json";
import ashby from "../../config/scout/templates/ashby.v1.json";
import avature from "../../config/scout/templates/avature.v1.json";
import eightfold from "../../config/scout/templates/eightfold.v1.json";
import gem from "../../config/scout/templates/gem.v1.json";
import greenhouse from "../../config/scout/templates/greenhouse.v1.json";
import icims from "../../config/scout/templates/icims.v1.json";
import jibe from "../../config/scout/templates/jibe.v1.json";
import jobsyn from "../../config/scout/templates/jobsyn.v1.json";
import lever from "../../config/scout/templates/lever.v1.json";
import oracleHcm from "../../config/scout/templates/oracle-hcm.v1.json";
import phenom from "../../config/scout/templates/phenom.v1.json";
import smartRecruiters from "../../config/scout/templates/smartrecruiters.v1.json";
import successFactorsRmk from "../../config/scout/templates/successfactors-rmk.v1.json";
import workday from "../../config/scout/templates/workday.v1.json";
import eightfoldV2 from "../../config/scout/templates/eightfold.v2.json";
import gemV2 from "../../config/scout/templates/gem.v2.json";
import greenhouseV2 from "../../config/scout/templates/greenhouse.v2.json";
import oracleHcmV2 from "../../config/scout/templates/oracle-hcm.v2.json";
import smartRecruitersV2 from "../../config/scout/templates/smartrecruiters.v2.json";
import successFactorsRmkV2 from "../../config/scout/templates/successfactors-rmk.v2.json";
import workdayV2 from "../../config/scout/templates/workday.v2.json";
import { createTemplateCatalog } from "../core/scout/sourcing/adapters/templates/definitions";

export const scoutTemplateCatalog = createTemplateCatalog([
  adp,
  ashby,
  avature,
  eightfold,
  gem,
  greenhouse,
  icims,
  jibe,
  jobsyn,
  lever,
  oracleHcm,
  phenom,
  smartRecruiters,
  successFactorsRmk,
  workday,
  eightfoldV2,
  gemV2,
  greenhouseV2,
  oracleHcmV2,
  smartRecruitersV2,
  successFactorsRmkV2,
  workdayV2,
]);
