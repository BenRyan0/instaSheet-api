
function normalizeKey(email) {
  if (!email || typeof email !== 'string') return null
  return email.toLowerCase().trim()
}

function filterNewLeads(leads, processed) {
  return leads.filter((lead) => {
    const emailKey = normalizeKey(lead.email)

    if (!emailKey) {
      console.log(`[skip] no valid email for lead: ${JSON.stringify(lead)}`)
      return false
    }

    if (processed.has(emailKey)) {
      console.log(`[skip] already processed email: ${emailKey}`)
      return false
    }

    console.log(`[process] new email to fetch replies: ${emailKey}`)
    return true
  })
}

module.exports = {
  normalizeKey,
  filterNewLeads,
}
