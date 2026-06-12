// prisma/seed.js — Development seed for the mentorship platform
// Run: npm run prisma:seed

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ── Tags ────────────────────────────────────────────────────
const TAG_DATA = [
  { name: 'DSA',           slug: 'dsa',           color: '#4f46e5' },
  { name: 'Placement',     slug: 'placement',     color: '#0891b2' },
  { name: 'Web Dev',       slug: 'web-dev',       color: '#059669' },
  { name: 'System Design', slug: 'system-design', color: '#d97706' },
  { name: 'DBMS',          slug: 'dbms',          color: '#dc2626' },
  { name: 'OS',            slug: 'os',            color: '#7c3aed' },
  { name: 'React',         slug: 'react',         color: '#0ea5e9' },
  { name: 'Node.js',       slug: 'nodejs',        color: '#65a30d' },
  { name: 'Python',        slug: 'python',        color: '#ca8a04' },
  { name: 'ML',            slug: 'ml',            color: '#9333ea' },
  { name: 'Resume',        slug: 'resume',        color: '#f97316' },
  { name: 'Internship',    slug: 'internship',    color: '#84cc16' },
  { name: 'CGPA',          slug: 'cgpa',          color: '#ef4444' },
  { name: 'Open Source',   slug: 'open-source',   color: '#10b981' },
];

async function seedTags() {
  console.log('Seeding tags...');
  const tags = [];
  for (const t of TAG_DATA) {
    const tag = await prisma.tag.upsert({ where: { slug: t.slug }, update: {}, create: t });
    tags.push(tag);
  }
  console.log(`  Created ${tags.length} tags`);
  return tags;
}

async function seedAdmin() {
  console.log('Seeding admin...');
  const ph = await bcrypt.hash('Admin@123456', 12);
  return prisma.user.upsert({
    where: { email: 'admin@mentorship.dev' },
    update: {},
    create: {
      email: 'admin@mentorship.dev', passwordHash: ph,
      username: 'platform_admin', anonymousAlias: 'ShadowKeeper#0001',
      role: 'SUPER_ADMIN', isEmailVerified: true,
      profile: { create: { displayName: 'Platform Admin', reputationPoints: 9999, isProfilePublic: false } },
    },
  });
}

async function seedMentors() {
  console.log('Seeding mentors...');
  const ph = await bcrypt.hash('Mentor@123456', 12);
  const data = [
    {
      email: 'senior.ananya@mentorship.dev', username: 'ananya_senior',
      anonymousAlias: 'CrypticOwl#0042', displayName: 'Ananya Sharma',
      bio: 'SDE-2 at Google. DSA and System Design specialist.',
      college: 'IIT Delhi', department: 'Computer Science', year: 'ALUMNI',
      headline: 'SDE-2 @ Google | IIT Delhi CSE 2022',
      expertise: ['DSA', 'System Design', 'React'], currentCompany: 'Google',
      yearsOfExperience: 2, placementYear: 2022,
      sessionTopics: ['Placement Prep', 'DSA Coaching', 'Mock Interviews'],
    },
    {
      email: 'rohan.mentor@mentorship.dev', username: 'rohan_codes',
      anonymousAlias: 'SwiftFalcon#0099', displayName: 'Rohan Verma',
      bio: 'Product Engineer at Amazon. Ask me anything about SDE roles.',
      college: 'NIT Trichy', department: 'Computer Science', year: 'ALUMNI',
      headline: 'Software Engineer @ Amazon | Ex-Microsoft Intern',
      expertise: ['Python', 'ML', 'System Design'], currentCompany: 'Amazon',
      yearsOfExperience: 3, placementYear: 2021,
      sessionTopics: ['ML Projects', 'Interview Prep'],
    },
  ];

  const mentors = [];
  for (const m of data) {
    const u = await prisma.user.upsert({
      where: { email: m.email }, update: {},
      create: {
        email: m.email, passwordHash: ph, username: m.username,
        anonymousAlias: m.anonymousAlias, role: 'MENTOR', isEmailVerified: true,
        profile: { create: { displayName: m.displayName, bio: m.bio, college: m.college, department: m.department, year: m.year, skills: m.expertise, reputationPoints: rand(200, 800) } },
        mentorProfile: { create: { headline: m.headline, expertise: m.expertise, currentCompany: m.currentCompany, yearsOfExperience: m.yearsOfExperience, placementYear: m.placementYear, isAvailable: true, sessionTopics: m.sessionTopics, totalSessions: rand(5, 40), avgRating: parseFloat((3.5 + Math.random() * 1.5).toFixed(1)), totalRatings: rand(5, 35), verifiedMentor: true } },
      },
    });
    mentors.push(u);
  }
  console.log(`  Created ${mentors.length} mentors`);
  return mentors;
}

async function seedStudents() {
  console.log('Seeding students...');
  const ph = await bcrypt.hash('Student@123456', 12);
  const data = [
    { email: 'stu.kavya@mentorship.dev', username: 'kavya_2023', anonymousAlias: 'QuietStorm#1101', displayName: 'Kavya Reddy', year: 'THIRD', college: 'VIT Vellore', department: 'CSE' },
    { email: 'stu.arjun@mentorship.dev', username: 'arjun_dsa',  anonymousAlias: 'CosmicPanda#2205', displayName: 'Arjun Mehta',  year: 'SECOND', college: 'DTU Delhi',   department: 'CSE' },
    { email: 'stu.sneha@mentorship.dev', username: 'sneha_ml',   anonymousAlias: 'AuroraByte#3307', displayName: 'Sneha Joshi',  year: 'FOURTH', college: 'IIIT Hyd',    department: 'CSE' },
  ];
  const students = [];
  for (const s of data) {
    const u = await prisma.user.upsert({
      where: { email: s.email }, update: {},
      create: { email: s.email, passwordHash: ph, username: s.username, anonymousAlias: s.anonymousAlias, role: 'STUDENT', isEmailVerified: true, profile: { create: { displayName: s.displayName, college: s.college, department: s.department, year: s.year, reputationPoints: rand(10, 100) } } },
    });
    students.push(u);
  }
  console.log(`  Created ${students.length} students`);
  return students;
}

async function seedPosts(users, tags) {
  console.log('Seeding posts...');
  const tagMap = Object.fromEntries(tags.map(t => [t.slug, t]));
  const postsData = [
    { title: 'How to crack FAANG with a 7 CGPA?', body: 'I have 7.2 CGPA in 6th semester. Been grinding Leetcode for 3 months (~180 problems). Does CGPA cutoff exist for off-campus applications? What should I focus on in the next 4 months?', anon: false, tags: ['placement', 'dsa', 'cgpa'] },
    { title: 'Complete System Design roadmap for college students', body: 'After 3 failed interviews I finally cracked system design. Phase 1: Client-server, DNS, CDN, Load Balancers. Phase 2: SQL vs NoSQL, Redis, Kafka. Phase 3: Practice — design URL shortener, Twitter, WhatsApp.', anon: false, tags: ['system-design', 'placement'] },
    { title: 'Is 7 pointer eligible for Amazon SDE internship?', body: 'Has anyone with below 7.5 CGPA gotten Amazon SDE internship through campus drive? Their JD says minimum 7.5 but I have heard Amazon sometimes relaxes this.', anon: true, tags: ['internship', 'placement', 'cgpa'] },
    { title: 'Struggling with Dynamic Programming — tips for a beginner?', body: 'I have been doing Leetcode for 2 months. Arrays and strings feel okay but every DP problem feels impossible. Currently stuck on Coin Change, LCS, and Knapsack. Is there a mental model that helps?', anon: true, tags: ['dsa', 'placement'] },
    { title: 'Sharing: 200+ Curated DSA problems by difficulty and company', body: 'Spent 2 weeks curating problems asked at Google, Amazon, Microsoft over the past 2 years. Categories: Arrays (30), Strings (25), Trees (35), Graphs (30), DP (40). Notion doc available on request!', anon: false, tags: ['dsa', 'placement', 'open-source'] },
  ];

  for (let i = 0; i < postsData.length; i++) {
    const pd = postsData[i];
    const author = users[i % users.length];
    await prisma.post.create({
      data: {
        authorId: author.id, title: pd.title, body: pd.body,
        isAnonymous: pd.anon, status: 'ACTIVE',
        slug: `${slugify(pd.title)}-${uuidv4().slice(0, 6)}`,
        upvoteCount: rand(5, 120), viewCount: rand(50, 800),
        trendingScore: Math.random() * 100,
        tags: { create: pd.tags.map(slug => ({ tag: { connect: { id: tagMap[slug].id } } })) },
      },
    });
  }
  console.log(`  Created ${postsData.length} posts`);
}

async function seedAvailability(mentors) {
  console.log('Seeding mentor availability...');
  let n = 0;
  for (const mentor of mentors) {
    const mp = await prisma.mentorProfile.findUnique({ where: { userId: mentor.id } });
    if (!mp) continue;
    for (const slot of [{ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }, { dayOfWeek: 3, startTime: '19:00', endTime: '21:00' }, { dayOfWeek: 6, startTime: '10:00', endTime: '13:00' }]) {
      await prisma.mentorAvailability.create({ data: { mentorProfileId: mp.id, ...slot } });
      n++;
    }
  }
  console.log(`  Created ${n} availability slots`);
}

async function main() {
  console.log('\nStarting database seed...\n');
  const tags = await seedTags();
  await seedAdmin();
  const mentors = await seedMentors();
  const students = await seedStudents();
  await seedPosts([...mentors, ...students], tags);
  await seedAvailability(mentors);

  console.log('\nSeed complete!');
  console.log('Credentials:');
  console.log('  Admin:   admin@mentorship.dev   / Admin@123456');
  console.log('  Mentor:  senior.ananya@mentorship.dev / Mentor@123456');
  console.log('  Student: stu.kavya@mentorship.dev / Student@123456\n');
}

main()
  .catch(e => { console.error('Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
