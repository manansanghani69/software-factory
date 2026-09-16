#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const statePath = process.env.FAKE_GH_STATE
if (statePath === undefined || statePath.length === 0) {
  console.error('FAKE_GH_STATE is required')
  process.exit(2)
}
mkdirSync(dirname(statePath), { recursive: true })

const defaultOwner = process.env.FAKE_GH_OWNER !== undefined && process.env.FAKE_GH_OWNER.length > 0 ? process.env.FAKE_GH_OWNER : 'fake-owner'

let state = { issues: [], prs: [], nextNumber: 1, nextPrNumber: 1, nextId: 1000001, repos: [], labels: [] }
if (existsSync(statePath)) {
  const parsed = JSON.parse(readFileSync(statePath, 'utf-8'))
  if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.issues)) {
    state = parsed
    if (state.nextId === undefined || state.nextId === null) {
      state.nextId = state.issues.reduce((max, issue) => Math.max(max, issueId(issue)), 1000000) + 1
    }
    if (state.prs === undefined) state.prs = []
    if (state.nextPrNumber === undefined) state.nextPrNumber = state.prs.length + 1
  }
}

function issueId(issue) {
  if (issue.id !== undefined && issue.id !== null) return issue.id
  return 1000000 + issue.number
}

function parseArgs(argv) {
  const opts = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-F' || arg === '-f') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('-')) {
        opts[arg] = true
      } else {
        const eq = next.indexOf('=')
        if (eq !== -1) {
          opts[next.slice(0, eq)] = next.slice(eq + 1)
        } else {
          opts[arg] = next
        }
        i += 1
      }
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        opts[key] = opts[key] ?? true
      } else {
        const current = opts[key]
        opts[key] = current === undefined ? next : Array.isArray(current) ? [...current, next] : [current, next]
        i += 1
      }
    } else {
      positional.push(arg)
    }
  }
  return { opts, positional }
}

function save() {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

function issueDto(issue) {
  const openBlockerNumbers = (issue.blockedBy ?? [])
    .map((blockerNumber) => {
      const blocker = state.issues.find((candidate) => candidate.number === blockerNumber)
      const blockerState = blocker === undefined || blocker.closed ? 'CLOSED' : 'OPEN'
      return { issue_id: blocker === undefined ? null : issueId(blocker), number: blockerNumber, state: blockerState }
    })
    .filter((entry) => entry.state === 'OPEN')
  return {
    id: issueId(issue),
    number: issue.number,
    title: issue.title,
    body: issue.body,
    url: issue.url,
    state: issue.closed ? 'CLOSED' : 'OPEN',
    assignees: (issue.assignees ?? []).map((login) => ({ login })),
    labels: (issue.labels ?? []).map((name) => ({ name })),
    issue_dependencies_summary: { blocked_by: openBlockerNumbers, blocking: [] },
  }
}

const args = process.argv.slice(2)
if (args[0] === 'label' && args[1] === 'list') {
  const { opts } = parseArgs(args.slice(2))
  const repo = typeof opts.repo === 'string' ? opts.repo : ''
  const names = [
    ...new Set(
      state.labels
        .filter((label) => repo.length === 0 || label.repo === '' || label.repo === repo)
        .map((label) => label.name),
    ),
  ]
  if (typeof opts.json === 'string' && opts.json.split(',').includes('name')) {
    const rows = names.map((name) => ({ name }))
    const jq = typeof opts.jq === 'string' ? opts.jq : ''
    if (jq === '.[].name') {
      for (const name of names) process.stdout.write(`${name}\n`)
    } else {
      process.stdout.write(JSON.stringify(rows))
    }
  } else {
    for (const name of names) process.stdout.write(`${name}\n`)
  }
} else if (args[0] === 'label' && args[1] === 'create') {
  const { opts, positional } = parseArgs(args.slice(2))
  const name = positional[0]
  state.labels.push({
    name,
    repo: typeof opts.repo === 'string' ? opts.repo : '',
    color: typeof opts.color === 'string' ? opts.color : '',
    description: typeof opts.description === 'string' ? opts.description : '',
  })
  save()
  process.stdout.write(`${name}\n`)
} else if (args[0] === 'issue' && args[1] === 'create') {
  const { opts } = parseArgs(args.slice(2))
  const title = typeof opts.title === 'string' ? opts.title : ''
  const body = typeof opts.body === 'string' ? opts.body : ''
  const labels = Array.isArray(opts.label) ? opts.label : opts.label === undefined ? [] : [opts.label]
  const repo = typeof opts.repo === 'string' ? opts.repo : ''
  const number = state.nextNumber
  state.nextNumber = number + 1
  const id = state.nextId
  state.nextId = id + 1
  const url = `https://github.com/${repo}/issues/${number}`
  state.issues.push({ number, id, title, body, repo, labels, url, comments: [], assignees: [], blockedBy: [], closed: false })
  save()
  const wanted = typeof opts.json === 'string' ? opts.json.split(',').filter(Boolean) : []
  const out = {}
  for (const field of wanted) {
    if (field === 'number') out.number = number
    else if (field === 'url') out.url = url
    else if (field === 'title') out.title = title
  }
  process.stdout.write(JSON.stringify(out))
} else if (args[0] === 'issue' && args[1] === 'comment') {
  const { opts, positional } = parseArgs(args.slice(2))
  const number = Number(positional[0])
  const issue = state.issues.find((candidate) => candidate.number === number)
  if (issue === undefined) {
    console.error(`fake gh: no issue #${number}`)
    process.exit(3)
  }
  issue.comments.push({ body: typeof opts.body === 'string' ? opts.body : '' })
  save()
} else if (args[0] === 'issue' && args[1] === 'close') {
  const { positional } = parseArgs(args.slice(2))
  const number = Number(positional[0])
  const issue = state.issues.find((candidate) => candidate.number === number)
  if (issue === undefined) {
    console.error(`fake gh: no issue #${number}`)
    process.exit(3)
  }
  issue.closed = true
  issue.closedAt = new Date().toISOString()
  save()
} else if (args[0] === 'issue' && args[1] === 'edit') {
  const { opts, positional } = parseArgs(args.slice(2))
  const number = Number(positional[0])
  const issue = state.issues.find((candidate) => candidate.number === number)
  if (issue === undefined) {
    console.error(`fake gh: no issue #${number}`)
    process.exit(3)
  }
  if (typeof opts.body === 'string') issue.body = opts.body
  if (typeof opts['add-assignee'] === 'string') {
    const login = opts['add-assignee'] === '@me' ? defaultOwner : opts['add-assignee']
    issue.assignees = [...new Set([...(issue.assignees ?? []), login])]
  }
  if (typeof opts['remove-assignee'] === 'string') {
    issue.assignees = (issue.assignees ?? []).filter((login) => login !== opts['remove-assignee'])
  }
  if (typeof opts['add-label'] === 'string') {
    issue.labels = [...new Set([...(issue.labels ?? []), opts['add-label']])]
  }
  if (typeof opts['remove-label'] === 'string') {
    issue.labels = (issue.labels ?? []).filter((label) => label !== opts['remove-label'])
  }
  save()
  process.stdout.write(`${issue.url}\n`)
} else if (args[0] === 'issue' && args[1] === 'view') {
  const { opts, positional } = parseArgs(args.slice(2))
  const number = Number(positional[0])
  const issue = state.issues.find((candidate) => candidate.number === number)
  if (issue === undefined) {
    console.error(`fake gh: no issue #${number}`)
    process.exit(3)
  }
  const wanted = typeof opts.json === 'string' ? opts.json.split(',').filter(Boolean) : []
  const out = {}
  for (const field of wanted) {
    if (field === 'comments') {
      out.comments = (issue.comments ?? []).map((comment, index) => ({
        author: { login: defaultOwner },
        body: comment.body,
        createdAt: comment.createdAt ?? '2026-09-16T00:00:00Z',
        url: `${issue.url}#issuecomment-${index + 1}`,
      }))
    } else if (field === 'number') out.number = issue.number
    else if (field === 'title') out.title = issue.title
    else if (field === 'body') out.body = issue.body
    else if (field === 'state') out.state = issue.closed ? 'CLOSED' : 'OPEN'
    else if (field === 'url') out.url = issue.url
    else if (field === 'assignees') out.assignees = (issue.assignees ?? []).map((login) => ({ login }))
    else if (field === 'labels') out.labels = (issue.labels ?? []).map((name) => ({ name }))
  }
  process.stdout.write(JSON.stringify(out))
} else if (args[0] === 'issue' && args[1] === 'list') {
  const { opts } = parseArgs(args.slice(2))
  const repo = typeof opts.repo === 'string' ? opts.repo : ''
  const stateFilter = typeof opts.state === 'string' ? opts.state : 'open'
  const rows = state.issues
    .filter((issue) => repo.length === 0 || issue.repo === repo)
    .filter((issue) => {
      if (stateFilter === 'all') return true
      if (stateFilter === 'closed') return issue.closed
      return !issue.closed
    })
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      url: issue.url,
      assignees: (issue.assignees ?? []).map((login) => ({ login })),
      labels: (issue.labels ?? []).map((name) => ({ name })),
    }))
    .sort((a, b) => a.number - b.number)
  process.stdout.write(JSON.stringify(rows))
} else if (args[0] === 'repo' && args[1] === 'create') {
  const { opts, positional } = parseArgs(args.slice(2))
  const fullName = positional[0]
  const url = `https://github.com/${fullName}`
  state.repos.push({
    fullName,
    visibility: typeof opts.private !== 'undefined' ? 'private' : 'public',
    source: typeof opts.source === 'string' ? opts.source : null,
    remote: typeof opts.remote === 'string' ? opts.remote : null,
    push: typeof opts.push !== 'undefined',
  })
  save()
  process.stdout.write(`${url}\n`)
} else if (args[0] === 'api') {
  const rest = args.slice(1)
  if (rest[0] === 'user') {
    process.stdout.write(JSON.stringify({ login: defaultOwner }))
  } else {
    const { opts, positional } = parseArgs(rest)
    const route = positional[0]
    const method = typeof opts.method === 'string' ? opts.method.toUpperCase() : 'GET'
    const segments = typeof route === 'string' ? route.split('/') : []
    if (segments.length >= 5 && segments[0] === 'repos' && segments[3] === 'issues') {
      const issueNumber = Number(segments[4])
      const issue = state.issues.find((candidate) => candidate.number === issueNumber)
      if (issue === undefined) {
        console.error(`fake gh: no issue #${issueNumber}`)
        process.exit(3)
      }
      const isDependencyRoute = segments[5] === 'dependencies' && segments[6] === 'blocked_by'
      if (isDependencyRoute && method === 'POST') {
        if (process.env.FAKE_GH_DISABLE_DEPENDENCIES === '1') {
          console.error('fake gh: issue dependencies disabled by FAKE_GH_DISABLE_DEPENDENCIES')
          process.exit(2)
        }
        const blocker = state.issues.find((candidate) => issueId(candidate) === Number(opts.issue_id))
        if (blocker === undefined) {
          console.error(`fake gh: no blocker with database id ${opts.issue_id}`)
          process.exit(3)
        }
        issue.blockedBy = [...new Set([...(issue.blockedBy ?? []), blocker.number])]
        save()
        process.stdout.write(JSON.stringify({ issue_id: Number(opts.issue_id), number: blocker.number }))
      } else {
        const dto = issueDto(issue)
        if (opts.jq === '.id') {
          process.stdout.write(String(dto.id))
        } else if (opts.jq === '.state') {
          process.stdout.write(dto.state)
        } else if (typeof opts.jq === 'string' && opts.jq.includes('blocked_by')) {
          process.stdout.write(JSON.stringify(dto.issue_dependencies_summary.blocked_by.map((entry) => entry.number)))
        } else {
          process.stdout.write(JSON.stringify(dto))
        }
      }
    } else {
      console.error(`fake gh: unsupported api route ${route}`)
      process.exit(2)
    }
  }
} else if (args[0] === 'pr' && args[1] === 'create') {
  const { opts } = parseArgs(args.slice(2))
  const repo = typeof opts.repo === 'string' ? opts.repo : ''
  const title = typeof opts.title === 'string' ? opts.title : ''
  const body = typeof opts.body === 'string' ? opts.body : ''
  const head = typeof opts.head === 'string' ? opts.head : 'feature'
  const base = typeof opts.base === 'string' ? opts.base : 'main'
  const stateVal = typeof opts.state === 'string' ? opts.state : 'open'
  const number = state.nextPrNumber
  state.nextPrNumber = number + 1
  const id = state.nextId
  state.nextId = id + 1
  const url = `https://github.com/${repo}/pull/${number}`
  state.prs.push({ number, id, title, body, repo, head, base, state: stateVal, url, createdAt: new Date().toISOString() })
  save()
  const wanted = typeof opts.json === 'string' ? opts.json.split(',').filter(Boolean) : []
  const out = {}
  for (const field of wanted) {
    if (field === 'number') out.number = number
    else if (field === 'url') out.url = url
    else if (field === 'title') out.title = title
  }
  process.stdout.write(JSON.stringify(out))
} else {
  console.error(`fake gh: unsupported subcommand ${args.join(' ')}`)
  process.exit(2)
}
