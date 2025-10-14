/**
 * Parent Category Definitions
 *
 * These are the 8 top-level legal categories used by the Belgian legal taxonomy.
 * These definitions are used by GPT-4o to select which 2-3 categories are most
 * relevant for each legal decision.
 *
 * EDIT THIS FILE to customize the descriptions used for taxonomy filtering.
 */

export interface ParentCategoryDefinition {
  id: string;
  nameFr: string;
  nameNl: string;
  descriptionFr: string;
  descriptionNl: string;
}

/**
 * 8 Parent Legal Categories
 *
 * Each category includes:
 * - id: Taxonomy identifier (KUU1-KUU8)
 * - nameFr: French name
 * - nameNl: Dutch name
 * - descriptionFr: French description (for GPT-4o selection)
 * - descriptionNl: Dutch description (for GPT-4o selection)
 */
export const PARENT_CATEGORIES: ParentCategoryDefinition[] = [
  {
    id: 'KUU1',
    nameFr: 'DROIT JUDICIAIRE',
    nameNl: 'GERECHTELIJK RECHT',
    descriptionFr:
      'Droit judiciaire - Questions de PROCÉDURE et COMPÉTENCE: règles procédurales, recevabilité, délais, voies de recours, conflits de compétence entre juridictions, preuves, autorité de chose jugée, exécution forcée. Sélectionner UNIQUEMENT si la procédure elle-même est l\'objet principal du litige, pas si elle est simplement accessoire au fond.',
    descriptionNl:
      'Gerechtelijk recht - Vragen van PROCEDURE en BEVOEGDHEID: procedureregels, ontvankelijkheid, termijnen, rechtsmiddelen, bevoegdheidsconflicten tussen rechtbanken, bewijs, gezag van gewijsde, gedwongen tenuitvoerlegging. ALLEEN selecteren als de procedure zelf het hoofdonderwerp van het geschil is, niet als het slechts bijkomstig is.',
  },
  {
    id: 'KUU2',
    nameFr: 'DROIT CIVIL',
    nameNl: 'BURGERLIJK RECHT',
    descriptionFr:
      'Droit civil - Relations entre PARTICULIERS: contrats entre personnes privées, responsabilité extracontractuelle, biens personnels et immobiliers, droit de la famille, successions, régimes matrimoniaux, statut des personnes. Exclut les aspects commerciaux entre entreprises (voir KUU4) et les relations de travail (voir KUU5).',
    descriptionNl:
      'Burgerlijk recht - Relaties tussen PARTICULIEREN: contracten tussen privépersonen, buitencontractuele aansprakelijkheid, persoonlijke en onroerende goederen, familierecht, erfenissen, huwelijksstelsels, personenstatuut. Sluit commerciële aspecten tussen bedrijven uit (zie KUU4) en arbeidsverhoudingen (zie KUU5).',
  },
  {
    id: 'KUU3',
    nameFr: 'DROIT PENAL',
    nameNl: 'STRAFRECHT',
    descriptionFr:
      'Droit pénal - Infractions PÉNALES et sanctions: crimes, délits, contraventions, peines et mesures de sûreté, procédure pénale, détention préventive, instruction judiciaire, jugement pénal, exécution des peines. Inclut les aspects civils accessoires (partie civile, dommages et intérêts) dans le cadre pénal.',
    descriptionNl:
      'Strafrecht - Strafbare feiten en sancties: misdaden, wanbedrijven, overtredingen, straffen en veiligheidsmaatregelen, strafprocedure, voorlopige hechtenis, gerechtelijk onderzoek, strafrechtelijke berechting, strafuitvoering. Omvat bijkomstige burgerlijke aspecten (burgerlijke partij, schadevergoeding) in het strafkader.',
  },
  {
    id: 'KUU4',
    nameFr: 'DROIT ÉCONOMIQUE, COMMERCIAL ET FINANCIER',
    nameNl: 'HANDELS-, ECONOMISCH EN FINANCIEEL RECHT',
    descriptionFr:
      'Droit économique, commercial et financier - Relations COMMERCIALES et ÉCONOMIQUES: sociétés commerciales et leur gouvernance, contrats entre entreprises, concurrence et pratiques du marché, propriété intellectuelle, opérations bancaires et financières, distribution commerciale, faillite et insolvabilité. Privilégier cette catégorie pour litiges entre professionnels/entreprises.',
    descriptionNl:
      'Handels-, economisch en financieel recht - COMMERCIËLE en ECONOMISCHE relaties: handelsvennootschappen en hun bestuur, contracten tussen ondernemingen, mededinging en marktpraktijken, intellectuele eigendom, bancaire en financiële verrichtingen, commerciële distributie, faillissement en insolventie. Deze categorie verkiezen voor geschillen tussen professionals/bedrijven.',
  },
  {
    id: 'KUU5',
    nameFr: 'DROIT SOCIAL',
    nameNl: 'SOCIAAL RECHT',
    descriptionFr:
      'Droit social - Relations de TRAVAIL et SÉCURITÉ SOCIALE: contrats de travail, conditions de travail, licenciement et fin de contrat, rémunération, sécurité sociale, accidents du travail, maladies professionnelles, chômage, pensions, relations collectives (syndicats, CCT, grèves). Couvre tous les aspects employeur-travailleur.',
    descriptionNl:
      'Sociaal recht - ARBEIDS- en SOCIALE ZEKERHEIDSrelaties: arbeidsovereenkomsten, arbeidsvoorwaarden, ontslag en contractbeëindiging, verloning, sociale zekerheid, arbeidsongevallen, beroepsziekten, werkloosheid, pensioenen, collectieve relaties (vakbonden, CAO, stakingen). Omvat alle aspecten werkgever-werknemer.',
  },
  {
    id: 'KUU6',
    nameFr: 'DROIT FISCAL',
    nameNl: 'FISCAAL RECHT',
    descriptionFr:
      'Droit fiscal - Questions FISCALES et impositions: impôts sur les revenus (personnes physiques et sociétés), TVA, droits d\'enregistrement et de succession, taxes régionales et locales, procédure fiscale, recouvrement, réclamations et recours contre l\'administration fiscale, redressements et sanctions fiscales.',
    descriptionNl:
      'Fiscaal recht - FISCALE vragen en belastingen: inkomstenbelastingen (natuurlijke personen en vennootschappen), BTW, registratie- en successierechten, gewestelijke en lokale belastingen, fiscale procedure, invordering, bezwaren en beroepen tegen de fiscale administratie, fiscale correcties en sancties.',
  },
  {
    id: 'KUU7',
    nameFr: 'DROIT PUBLIC ET ADMINISTRATIF',
    nameNl: 'PUBLIEK EN ADMINISTRATIEF RECHT',
    descriptionFr:
      'Droit public et administratif - Relations avec les AUTORITÉS PUBLIQUES: organisation de l\'État et des collectivités, fonction publique et agents publics, marchés publics, urbanisme et aménagement du territoire, permis et autorisations administratives, environnement, police administrative, subventions publiques, responsabilité des autorités publiques. Exclut les aspects fiscaux (voir KUU6).',
    descriptionNl:
      'Publiek en administratief recht - Relaties met OVERHEIDSINSTANTIES: organisatie van de Staat en gemeenschappen, openbare dienst en ambtenaren, overheidsopdrachten, stedenbouw en ruimtelijke ordening, vergunningen en administratieve machtigingen, milieu, bestuurlijke politie, overheidssubsidies, aansprakelijkheid van overheden. Sluit fiscale aspecten uit (zie KUU6).',
  },
  {
    id: 'KUU8',
    nameFr: 'DROIT INTERNATIONAL',
    nameNl: 'INTERNATIONAAL RECHT',
    descriptionFr:
      'Droit international - Dimensions INTERNATIONALES et EUROPÉENNES: droit international public, traités internationaux, droit de l\'Union européenne et CJUE, droit international privé, conflits de lois, compétence internationale des juridictions, reconnaissance et exécution des jugements étrangers, extradition, coopération judiciaire internationale. Inclut les questions transfrontalières.',
    descriptionNl:
      'Internationaal recht - INTERNATIONALE en EUROPESE dimensies: internationaal publiekrecht, internationale verdragen, recht van de Europese Unie en HvJ-EU, internationaal privaatrecht, wetsconflicten, internationale bevoegdheid van rechtbanken, erkenning en tenuitvoerlegging van buitenlandse vonnissen, uitlevering, internationale justitiële samenwerking. Omvat grensoverschrijdende kwesties.',
  },
];

/**
 * Get parent category by ID
 */
export function getParentCategoryById(id: string): ParentCategoryDefinition | undefined {
  return PARENT_CATEGORIES.find((cat) => cat.id === id);
}

/**
 * Get parent category description by name
 * Fallback for when full definition is not found
 */
export function getParentDescriptionByName(
  name: string,
  language: 'fr' | 'nl' = 'fr'
): string {
  const category = PARENT_CATEGORIES.find(
    (cat) => cat.nameFr === name || cat.nameNl === name
  );

  if (!category) {
    return name; // Fallback to name itself
  }

  return language === 'fr' ? category.descriptionFr : category.descriptionNl;
}