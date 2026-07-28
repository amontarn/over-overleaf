import { vi, expect } from 'vitest'
import path from 'node:path'
import sinon from 'sinon'
import mongodb from 'mongodb-legacy'

const { ObjectId } = mongodb

const MODULE_PATH = path.join(
  import.meta.dirname,
  '../../../app/src/git/GitTokenManager'
)

describe('GitTokenManager', function () {
  beforeEach(async function (ctx) {
    ctx.userId = new ObjectId()
    ctx.record = {
      _id: new ObjectId(),
      userId: ctx.userId,
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 1000),
    }

    ctx.db = {
      users: {
        findOne: sinon.stub().resolves({ _id: ctx.userId, suspended: false }),
      },
    }

    ctx.GitAccessToken = {
      findOne: sinon.stub().returns({
        lean: () => ({ exec: () => Promise.resolve(ctx.record) }),
      }),
      updateOne: sinon.stub().returns({ exec: () => Promise.resolve() }),
      updateMany: sinon.stub().returns({ exec: () => Promise.resolve() }),
    }

    vi.doMock('@overleaf/settings', () => ({
      default: {
        communityFeatures: {
          encryptionSecret: 'test-secret-at-least-16-characters',
        },
      },
    }))
    vi.doMock('../../../../../app/src/infrastructure/mongodb.mjs', () => ({
      db: ctx.db,
    }))
    vi.doMock('../../../app/src/git/GitAccessToken.mjs', () => ({
      GitAccessToken: ctx.GitAccessToken,
    }))

    ctx.GitTokenManager = (await import(MODULE_PATH)).default
  })

  describe('authenticate', function () {
    it('returns the record for an active user', async function (ctx) {
      const result = await ctx.GitTokenManager.authenticate('olp_valid')
      expect(result).to.equal(ctx.record)
      expect(ctx.GitAccessToken.updateOne.called).to.equal(true)
    })

    it('rejects a token whose owner is suspended', async function (ctx) {
      ctx.db.users.findOne.resolves({ _id: ctx.userId, suspended: true })
      const result = await ctx.GitTokenManager.authenticate('olp_valid')
      expect(result).to.equal(null)
      expect(ctx.GitAccessToken.updateOne.called).to.equal(false)
    })

    it('rejects a token whose owner no longer exists', async function (ctx) {
      ctx.db.users.findOne.resolves(null)
      const result = await ctx.GitTokenManager.authenticate('olp_valid')
      expect(result).to.equal(null)
    })

    it('rejects a token without the olp_ prefix without touching the database', async function (ctx) {
      const result = await ctx.GitTokenManager.authenticate('nope')
      expect(result).to.equal(null)
      expect(ctx.GitAccessToken.findOne.called).to.equal(false)
    })
  })

  describe('revokeAllForUser', function () {
    it('revokes every live token for the user', async function (ctx) {
      await ctx.GitTokenManager.revokeAllForUser(ctx.userId)
      const [filter, update] = ctx.GitAccessToken.updateMany.firstCall.args
      expect(filter.userId).to.equal(ctx.userId)
      expect(filter.revokedAt).to.deep.equal({ $exists: false })
      expect(update.$set.revokedAt).to.be.instanceOf(Date)
    })
  })
})
