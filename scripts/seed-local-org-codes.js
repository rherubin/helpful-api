/**
 * Upsert production-like org_codes rows into the local MySQL DB (same as the API).
 * Run: node scripts/seed-local-org-codes.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getPool, closePool } = require('../config/database');
const OrgCode = require('../models/OrgCode');

const ANTIOCH_INITIAL_PROMPT = `Specifically, please use the following teaching as the foundational teaching for the reflections:

In this sermon on Mark 11:1–26, the pastor connects the fig-tree episode and Jesus' cleansing of the temple to diagnose four concrete "pitfalls to a fruitful Christian life." First, he warns against appearing spiritual from a distance — having leaves (appearance, programs, language) but no fruit (the inward character of the Spirit). Second, he cautions that repeated disobedience can dull our sensitivity to the Holy Spirit's conviction, leaving us unresponsive even when God speaks clearly. Third, he distinguishes mere belief from active trusting faith (put your faith in "drive," not reverse/neutral/park): true faith engages God to do what we cannot. Fourth, he explains how unforgiveness becomes a weight that blocks intimacy with God and limits fruitfulness — forgiveness is for our freedom, can coexist with healthy boundaries, and may be a process. Throughout he threads pastoral application: honest self-examination (Where is my life "leaves only"?), repentance, asking the Spirit to restore sensitivity, practicing active trust in prayers for "mountain-moving" needs, and working through forgiveness with boundaries and time when necessary.`;

const CORNERCHURCH_INITIAL_PROMPT = `Specifically, please use the following teaching as the foundational teaching for the reflections:

The pastor opens with a vivid illustration: a teenage boy receives a Ferrari as a gift, only to discover it is a display model — beautiful on the outside, but hollow and unmovable. The punchline lands as the thesis: what good is something that looks great on the outside but is empty within?
Core Text & Setting
Jesus confronts a group of Pharisees (Mark 7:1–23) who have traveled from Jerusalem to challenge him over ceremonial handwashing. Rather than defending his disciples, Jesus goes on offense — calling them hypocrites who have elevated man-made tradition to the level of God's commands, while quietly sidestepping the actual heart of the law.
Key Themes
1. Outward religion vs. inward transformation. The Pharisees had mastered the appearance of holiness — the rituals, the vocabulary, the authority — but Jesus quotes Isaiah: "These people honor me with their lips, but their hearts are far from me." The pastor draws this into the present: many Christians today know the church script but haven't let any of it reach their heart. Like a barista who knows every drink but doesn't enjoy coffee herself.
2. Sin is a heart problem, not a behavior problem. Jesus lists the things that actually defile a person — evil thoughts, greed, pride, sexual immorality — and locates all of them within, not in food, hands, or external acts. Trying harder or learning more information won't fix what lives at that depth. Only God can reach far enough to change it.
3. The Renovation of the Heart. Drawing on Dallas Willard's book of the same name, the pastor frames spiritual growth as an ongoing renovation project — not a one-time fix. Willard's three-part framework: Vision (see that life with Jesus is genuinely better), Intention (commit to pursuing it), and Means (lovingly practicing the spiritual disciplines — prayer, Scripture, community, baptism, communion — not as boxes to check, but as channels God uses to reach deeper).
4. There is always another project. Renovation never fully ends. Whether you've followed Jesus for two years or twenty, God is still tapping you on the shoulder about the next area that needs work. The invitation is to ask honestly: what is the next renovation project Jesus has for my heart?
Closing Application
The sermon moves into communion as a lived example of the means of grace — not a motion to go through, but a moment to let God draw closer. The pastor invites honest preparation: lay down unrepentant sin, anger, bitterness, shame. The bread and cup aren't ritual — they're a reminder that Jesus' broken body and shed blood created a forgiveness that can sink into your soul and make you new.`;

const ROWS = [
  {
    id: '9e868a30-1e8e-11f1-bea4-a2aa39c9ff65',
    org_code: 'calstg',
    organization: "Calvary St. George's",
    address1: '277 Park Ave S.',
    address2: null,
    city: 'New York',
    state: 'NY',
    postalCode: '10010',
    initial_program_prompt: null,
    next_program_prompt: null,
    therapy_response_prompt: null,
    expires_at: '2027-03-01 00:00:00',
    created_at: '2026-03-13 03:42:11',
    updated_at: '2026-03-13 03:42:11',
    duration_start: '2026-03-01 00:00:00',
    duration_end: '2027-03-01 00:00:00',
  },
  {
    id: '9e868f64-1e8e-11f1-bea4-a2aa39c9ff65',
    org_code: 'city',
    organization: 'Church of the City',
    address1: '417 W 57th St',
    address2: null,
    city: 'New York',
    state: 'NY',
    postalCode: '10019',
    initial_program_prompt: null,
    next_program_prompt: null,
    therapy_response_prompt: null,
    expires_at: '2027-03-01 00:00:00',
    created_at: '2026-03-13 03:42:11',
    updated_at: '2026-03-13 03:42:11',
    duration_start: '2026-03-01 00:00:00',
    duration_end: '2027-03-01 00:00:00',
  },
  {
    id: '9e869064-1e8e-11f1-bea4-a2aa39c9ff65',
    org_code: 'antioch',
    organization: 'Antioch Community Church',
    address1: 'DeLaSalle High School, 1 De La Salle Dr',
    address2: null,
    city: 'Minneapolis',
    state: 'MN',
    postalCode: '55401',
    initial_program_prompt: ANTIOCH_INITIAL_PROMPT,
    next_program_prompt: null,
    therapy_response_prompt: null,
    expires_at: '2027-03-01 00:00:00',
    created_at: '2026-03-13 03:42:11',
    updated_at: '2026-04-11 01:15:26',
    duration_start: '2026-03-01 00:00:00',
    duration_end: '2027-03-01 00:00:00',
  },
  {
    id: '9e8690eb-1e8e-11f1-bea4-a2aa39c9ff65',
    org_code: 'parkslope',
    organization: 'Park Slope Church',
    address1: '139 St Johns Place',
    address2: null,
    city: 'Brooklyn',
    state: 'NY',
    postalCode: '11217',
    initial_program_prompt: null,
    next_program_prompt: null,
    therapy_response_prompt: null,
    expires_at: '2027-03-01 00:00:00',
    created_at: '2026-03-13 03:42:11',
    updated_at: '2026-03-13 03:42:11',
    duration_start: '2026-03-01 00:00:00',
    duration_end: '2027-03-01 00:00:00',
  },
  {
    id: '9e869167-1e8e-11f1-bea4-a2aa39c9ff65',
    org_code: 'keller',
    organization: 'Redeemer Presbyterian',
    address1: '150 W 83rd St',
    address2: null,
    city: 'New York',
    state: 'NY',
    postalCode: '10024',
    initial_program_prompt: null,
    next_program_prompt: null,
    therapy_response_prompt: null,
    expires_at: '2027-03-01 00:00:00',
    created_at: '2026-03-13 03:42:11',
    updated_at: '2026-03-13 03:42:11',
    duration_start: '2026-03-01 00:00:00',
    duration_end: '2027-03-01 00:00:00',
  },
  {
    id: '9e8691e5-1e8e-11f1-bea4-a2aa39c9ff65',
    org_code: 'christchurch',
    organization: 'Christ Church Anglican',
    address1: '5500 W 91st St',
    address2: null,
    city: 'Overland Park',
    state: 'KS',
    postalCode: '66207',
    initial_program_prompt: null,
    next_program_prompt: null,
    therapy_response_prompt: null,
    expires_at: '2027-03-01 00:00:00',
    created_at: '2026-03-13 03:42:11',
    updated_at: '2026-03-13 03:42:11',
    duration_start: '2026-03-01 00:00:00',
    duration_end: '2027-03-01 00:00:00',
  },
  {
    id: 'cf9a3e9f-3546-11f1-bea4-a2aa39c9ff65',
    org_code: 'cornerchurch',
    organization: 'Corner Church',
    address1: '514 N 3rd St',
    address2: 'Ste 102',
    city: 'Minneapolis',
    state: 'MN',
    postalCode: '55401',
    initial_program_prompt: CORNERCHURCH_INITIAL_PROMPT,
    next_program_prompt: null,
    therapy_response_prompt: null,
    expires_at: '2026-04-11 01:36:07',
    created_at: '2026-04-11 01:46:06',
    updated_at: null,
    duration_start: null,
    duration_end: null,
  },
];

const UPSERT_SQL = `
  INSERT INTO org_codes (
    id, org_code, organization, address1, address2, city, state, postalCode,
    initial_program_prompt, next_program_prompt, therapy_response_prompt,
    expires_at, duration_start, duration_end, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    org_code = VALUES(org_code),
    organization = VALUES(organization),
    address1 = VALUES(address1),
    address2 = VALUES(address2),
    city = VALUES(city),
    state = VALUES(state),
    postalCode = VALUES(postalCode),
    initial_program_prompt = VALUES(initial_program_prompt),
    next_program_prompt = VALUES(next_program_prompt),
    therapy_response_prompt = VALUES(therapy_response_prompt),
    expires_at = VALUES(expires_at),
    duration_start = VALUES(duration_start),
    duration_end = VALUES(duration_end),
    created_at = VALUES(created_at),
    updated_at = VALUES(updated_at)
`;

async function main() {
  const pool = getPool();
  const orgCodeModel = new OrgCode(pool);
  await orgCodeModel.initDatabase();

  for (const r of ROWS) {
    const params = [
      r.id,
      r.org_code,
      r.organization,
      r.address1,
      r.address2,
      r.city,
      r.state,
      r.postalCode,
      r.initial_program_prompt,
      r.next_program_prompt,
      r.therapy_response_prompt,
      r.expires_at,
      r.duration_start,
      r.duration_end,
      r.created_at,
      r.updated_at,
    ];
    await pool.execute(UPSERT_SQL, params);
    console.log('Upserted org_code:', r.org_code, r.id);
  }

  console.log(`Done. ${ROWS.length} rows in org_codes.`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
