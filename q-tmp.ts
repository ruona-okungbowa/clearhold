import { db } from './lib/db';
const t = async (name: string, p: Promise<unknown[]>) => { const s = Date.now(); const r = await p; console.log(name.padEnd(12), r.length, Date.now() - s, 'ms'); };
(async () => {
  await db.hire.count();
  const s = Date.now();
  await Promise.all([
    t('auths', db.authorization.findMany({ omit: { updatedAt: true }, orderBy: { createdAt: 'asc' } })),
    t('hires', db.hire.findMany({ omit: { createdAt: true }, orderBy: { startAt: 'asc' } })),
    t('findings', db.finding.findMany({ omit: { knownMarkId: true, model: true, promptVersion: true, createdAt: true }, orderBy: { createdAt: 'asc' } })),
    t('approvals', db.approval.findMany({ where: { finalCapture: true, usedAt: null, expiresAt: { gt: new Date() } }, select: { authorizationId: true } })),
    t('contests', db.contest.findMany({ select: { hireId: true } })),
    t('captures', db.capture.findMany({ where: { finalCapture: true, amountGBP: { gt: 0 } }, select: { authorizationId: true, amountGBP: true } })),
    t('marks', db.itemMark.findMany()),
    t('photos', db.photo.findMany({ where: { stage: 'pickup', angle: 'front' }, select: { id: true, hireId: true } })),
    t('layout', db.studioLayout.findMany()),
  ]);
  console.log('all', Date.now() - s, 'ms');
  await db.$disconnect();
})();
