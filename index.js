const express = require('express')
var cors = require('cors')
const jwt = require('jsonwebtoken')
const app = express()
const fetch = require('cross-fetch')
const cron = require('node-cron');
require('dotenv').config()
const PORT = process.env.PORT || 5050
const supabase = require('@supabase/supabase-js').createClient(process.env.API_URL, process.env.API_KEY)
const invalidChar = new Set('/', '\\', '\n', '\t', '$', '?', '!', '@', '*')

const GDClient = require('geometry-dash-api');

const client = new GDClient({
    userName: 'dummy',
    password: 'dummy'
});
async function getLevel(id) {
    var level = {
        levelID: null,
        name: null,
        desc: null,
        version: null,
        creatorUserID: null,
        diff: null,
        downloads: null,
        likes: null,
        track: null,
        gameVersion: null,
        demonDiff: null,
        stars: null,
        isFeatured: null,
        isEpic: null,
        length: null,
        original: null,
        songID: null,
        coins: null,
        requestedStars: null,
        isLDM: null,
        password: null
    }
    try {
        level = await client.api.levels.getById({ levelID: parseInt(id) })
    }
    catch {
        return level
    }
    level.desc = Buffer.from(level.desc, 'base64').toString()
    level['difficulty'] = level.diff
    if (level.stars == 10) {
        if (level.diff == 'Easy') level.difficulty = 'Easy Demon'
        else if (level.diff == 'Normal') level.difficulty = 'Medium Demon'
        else if (level.diff == 'Hard') level.difficulty = 'Hard Demon'
        else if (level.diff == 'Harder') level.difficulty = 'Insane Demon'
        else level.difficulty = 'Extreme Demon'
    }
    level.verifiedCoins = true
    level.length = level.length[0].toUpperCase() + level.length.slice(1).toLowerCase()
    if (level.length == 'Xl') level.length = 'XL'
    return level
}
async function getCreator(id) {
    const user = await client.api.users.find({ query: id, page: 0 });
    return user.users[0]
}
async function checkAdmin(token) {
    try {
        jwt.verify(token, process.env.JWT_SECRET)
        user = jwt.decode(token)
        var { data, error } = await supabase
            .from('players')
            .select('*')
            .eq('uid', user.sub)
            .single()
        return data
    }
    catch (err) {
        return false
    }
}

function checkUser(token, uid) {
    try {
        jwt.verify(token, process.env.JWT_SECRET)
        user = jwt.decode(token)
        return user.sub == uid
    }
    catch (err) {
        return false
    }
}

async function sendLog(msg, url = process.env.DISCORD_WEBHOOK) {
    console.log(msg, url)
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            content: msg
        })
    })
}

cron.schedule('0 0 * * *', async () => {
    const { error } = await supabase.rpc('updateRank')
    console.log(error)
    console.log("Updated players rank")
});

app.use(express.json())
app.use(cors())

app.get('/level/:id', async (req, res) => {
    const { id, country } = req.params
    const d = {
        data: {},
        records: []
    }
    var { data, error } = await supabase
        .from('levels')
        .select('*')
        .eq('id', id)
    if (data.length == 0) {
        res.status(400).send({
            error: 'Level does not exists'
        })
        return
    }
    d.data = data[0]
    const lvapi = await getLevel(id)
    d.data['difficulty'] = lvapi.difficulty
    d.data['description'] = lvapi.desc
    d.data['downloads'] = lvapi.downloads
    d.data['likes'] = lvapi.likes
    if (lvapi.disliked) d.data.likes *= -1
    d.data['length'] = lvapi.length
    d.data['coins'] = lvapi.coins
    d.data['verifiedCoins'] = lvapi.verifiedCoins
    var { data, error } = await supabase
        .from('records')
        .select('*, players!inner(name, rating, isHidden)')
        .eq('levelid', id)
        .eq('players.isHidden', false)
        .eq('isChecked', true)
        .order('progress', { ascending: false })
        .order('timestamp', { ascending: true })
    d.records = data
    res.status(200).send(d)
})
app.delete('level/:id', async (req, res) => {
    const { token } = req.body
    checkAdmin(token).then(async (user) => {
        if (!user.isAdmin) {
            res.status(401).send({
                'error': 'Token Invalid'
            })
        }
        const { id } = req.params
        await supabase.from("submissions").delete().match({ levelid: item.id });
        await supabase.from('levels').delete().match({ id: id })
        res.status(200)
        await supabase.rpc('updateList')
        sendLog(`${user.name} (${user.uid}) deleted ${id}`)
    })
})
app.get('/level/:id/:country', async (req, res) => {
    const { id, country } = req.params
    const d = {
        data: {},
        records: []
    }
    var { data, error } = await supabase
        .from('levels')
        .select('*')
        .eq('id', id)
    if (data.length == 0) {
        res.status(400).send({
            error: 'Level does not exists'
        })
        return
    }
    d.data = data[0]
    const lvapi = await getLevel(id)
    d.data['difficulty'] = lvapi.difficulty
    d.data['description'] = lvapi.desc
    d.data['downloads'] = lvapi.downloads
    d.data['likes'] = lvapi.likes
    if (lvapi.disliked) d.data.likes *= -1
    d.data['length'] = lvapi.length
    d.data['coins'] = lvapi.coins
    d.data['verifiedCoins'] = lvapi.verifiedCoins
    d.records = []
    var { data, error } = await supabase
        .from('records')
        .select('*, players(name, country)')
        .eq('levelid', id)
        .order('progress', { ascending: false })
        .order('timestamp', { ascending: true })
    for (const i of data) {
        if (i.players.country == country) d.records.push(i)
    }
    res.status(200).send(d)
})
app.post('/level/:id', (req, res) => {
    var { token } = req.body
    checkAdmin(token).then(async (user) => {
        if (!user.isAdmin) {
            res.status(401).send({
                'error': 'Token Invalid'
            })
            return
        }
        const { id } = req.params
        var level = {
            name: null,
            creator: null,
            videoID: null,
            minProgress: null,
            flTop: null,
            dlTop: null,
            seaTop: null
        }
        var { data } = req.body
        for (const i in data) {
            if (i in level) {
                level[i] = data[i]
            }
        }
        if (level.flTop != null) level.flTop -= 0.5
        if (level.dlTop != null) level.dlTop -= 0.5
        if (level.seaTop != null) level.seaTop -= 0.5
        level.id = parseInt(id)
        var { data, error } = await supabase
            .from('levels')
            .insert(level)
        if (error) {
            res.status(500).send(error)
            return
        }

        if (error) {
            res.status(500).send(error)
            return
        }
        res.status(200).send(level)
        await supabase.rpc('updateList')
        sendLog(`${user.name} (${user.uid}) added ${level.name} (${id})`)
    })
})
app.patch('/level/:id', (req, res) => {
    const { token } = req.body
    checkAdmin(token).then(async (user) => {
        if (!user.isAdmin) {
            res.status(401).send({
                'error': 'Token Invalid'
            })
            return
        }
        var level = {
            name: null,
            creator: null,
            videoID: null,
            minProgress: null,
            flTop: null,
            dlTop: null,
            seaTop: null,
            rating: null
        }
        const { id } = req.params
        var data = req.body.data

        if (data.flTop == null) { }
        else if (data.prevflTop == null) data.seaTop -= 0.5
        else if (data.flTop < data.prevflTop) data.flTop -= 0.5
        else if (data.flTop > data.prevflTop) data.flTop += 0.5

        if (data.seaTop == null) { }
        else if (data.prevseaTop == null) data.seaTop -= 0.5
        else if (data.seaTop < data.prevseaTop) data.seaTop -= 0.5
        else if (data.seaTop > data.prevseaTop) data.dlTop += 0.5

        for (const i in data) {
            if (i in level) {
                level[i] = data[i]
            }
        }
        if (level.minProgress < 1) level.minProgress = 100
        level.id = parseInt(id)
        if (!level.dlTop && !level.flTop && !level.seaTop) {
            var { data, error } = await supabase
                .from('submissions')
                .delete()
                .match({ levelid: level.id })
            var { data, error } = await supabase
                .from('records')
                .delete()
                .match({ levelid: level.id })
            var { data, error } = await supabase
                .from('levels')
                .delete()
                .match({ id: level.id })
        }
        else {
            var { data, error } = await supabase
                .from('levels')
                .update(level)
                .match({ id: level.id })
            if (error) {
                res.status(500).send(error)
                return
            }
        }

        if (error) {
            res.status(500).send(error)
            return
        }
        sendLog(`${user.name} (${user.uid}) modified ${level.name} (${id})`)
        res.status(200).send(level)
        await supabase.rpc('updateList')
    })
})

app.get('/levels/:list/page/:id/:filter?', async (req, res) => {
    const { id, list } = req.params
    const filter = {
        minTop: 0,
        maxTop: 1000,
        minPt: 0,
        maxPt: 10000,
    }
    const reqFilter = JSON.parse(req.params.filter)
    if ('filter' in req.params){
        for(i in filter){
            if(i in reqFilter){
                filter[i] = reqFilter[i]
            }
        }
    }
    var listPtName = list == 'dl' ? 'rating' : `${list}Pt`
    var { data, error } = await supabase
        .from('levels')
        .select('*')
        .order(`${list}Top`, { ascending: true })
        .range((id - 1) * 300, id * 300 - 1)
        .not(`${list}Top`, 'is', null)
        .gte(`${list}Top`, filter.minTop)
        .lte(`${list}Top`, filter.maxTop)
        .gte(listPtName, filter.minPt)
        .lte(listPtName, filter.maxPt)

    if (error) {
        res.status(400).send(error)
        return
    }
    res.status(200).send(data)
})
app.get('/levels/:list/page/:id/:uid/:filter?', async (req, res) => {
    const { id, list, uid } = req.params
    const filter = {
        minTop: 0,
        maxTop: 1000,
        minPt: 0,
        maxPt: 10000,
        hideBeatenLevels: false
    }
    const reqFilter = JSON.parse(req.params.filter)
    if ('filter' in req.params) {
        for (i in filter) {
            if (i in reqFilter) {
                filter[i] = reqFilter[i]
            }
        }
    }
    var listPtName = list == 'dl' ? 'rating' : `${list}Pt`
    var { data, error } = await supabase
        .from('levels')
        .select('*')
        .order(`${list}Top`, { ascending: true })
        .range((id - 1) * 300, id * 300 - 1)
        .not(`${list}Top`, 'is', null)
        .gte(`${list}Top`, filter.minTop)
        .lte(`${list}Top`, filter.maxTop)
        .gte(listPtName, filter.minPt)
        .lte(listPtName, filter.maxPt)

    if (error) {
        res.status(400).send(error)
        return
    }
    var result = data
    var { data, error } = await supabase
        .from('records')
        .select('userid, levelid, progress' )
        .eq('userid', uid)
        .eq('isChecked', true)
    var mp = {}
    for (const i of data) {
        mp[i.levelid] = i
    }
    for (const i of result) {
        i['progress'] = 0
        if (mp.hasOwnProperty(i.id)) i['progress'] = mp[i.id].progress
    }
    if(filter.hideBeatenLevels){
        const res = []
        for (const i of result) {
            if (i.progress != 100) res.push(i)
        }
        result = res
    }
    res.status(200).send(result)
})
app.get('/player/:id', async (req, res) => {
    const { id } = req.params
    var { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('uid', id)
        .single()
    if (!data) {
        res.status(400).send({
            error: 'Player does not exists'
        })
        return
    }
    res.status(200).send(data)
})
app.get('/player/:id/submissions', async (req, res) => {
    const { id } = req.params
    var { data, error } = await supabase
        .from('records')
        .select('*, levels(name)')
        .eq('userid', id)
        .eq('isChecked', false)
        .order("timestamp", { ascending: false })
    console.log(data, error)
    res.status(200).send(data)
})
app.get('/player/:id/records/:order', async (req, res) => {
    const { id, order } = req.params
    var { data, error } = await supabase
        .from('records')
        .select('*, levels(name)')
        .eq('userid', id)
        .eq('isChecked', true)
        .order(order, { ascending: false })
    res.status(200).send(data)
})
app.get('/players/rating/page/:id', async (req, res) => {
    const { id } = req.params
    const { data, error } = await supabase
        .from('players')
        .select('*')
        .order(`rating`, { ascending: false })
        .range((id - 1) * 300, id * 300 - 1)
        .not(`rating`, 'is', null)
        .gte('rating', 0.1)
        .match({ isHidden: false })
    if (error) {
        res.status(400).send(error)
        return
    }
    res.status(200).send(data)
})
app.get('/players/:list/page/:id', async (req, res) => {
    const { id, list } = req.params
    const { data, error } = await supabase
        .from('players')
        .select('*')
        .order(`${list}rank`, { ascending: true })
        .range((id - 1) * 300, id * 300 - 1)
        .not(`${list}rank`, 'is', null)
        .match({ isHidden: false })
    if (error) {
        res.status(400).send(error)
        return
    }
    res.status(200).send(data)
})
app.patch('/player/:id', async (req, res) => {
    const { id } = req.params
    var { token, data } = req.body
    a = data
    if (!checkUser(token, id)) {
        res.status(403).send({})
        return
    }
    user = jwt.decode(token)
    delete data.isAdmin
    if (data.name.length > 20) {
        res.status(400).send({
            error: 'Name is too long (max 20 characters)'
        })
        return
    }
    for (let i = 0; i < data.name.length; i++) {
        if (invalidChar.has(data.name[i])) {
            res.status(400).send({
                error: 'Invalid name'
            })
            return
        }
    }
    var { data, error } = await supabase
        .from('players')
        .update(a)
        .match({ uid: user.sub })
    res.status(200).send(data)
    if(a.isHidden) await supabase.rpc('updateRank')
    
})
app.get('/search/:id', async (req, res) => {
    var { id } = req.params
    if (isNaN(id)) {
        var m = {}
        var { data, error } = await supabase
            .from('levels')
            .select('*')
            .textSearch('name', `'${id}'`, {
                type: 'websearch',
                config: 'english'
            })
        for (var i = 0; i < data.length; i++) {
            m[data[i].id] = data[i]
        }
        var { data, error } = await supabase
            .from('players')
            .select('name, uid, isHidden')
            .textSearch('name', `'${id}'`, {
                type: 'websearch',
                config: 'english'
            })
            .eq('isHidden', false)
        var players = []
        for (var i = 0; i < data.length; i++) {
            players.push({
                id: data[i].uid,
                name: data[i].name
            })
        }
        var list = []
        for (const i in m) {
            list.push(m[i])
        }
        res.status(200).send([list, players])
    }
    else {
        var { data, error } = await supabase
            .from('levels')
            .select('*')
            .eq('id', id)
        res.status(200).send([data, []])
    }
})
app.put('/record', async (req, res) => {
    var { token } = req.body
    checkAdmin(token).then(async (user) => {
        if (!user.isAdmin) {
            res.status(401).send({
                'error': 'Token Invalid'
            })
            return
        }
        var record = req.body.data
        var { data, error } = await supabase
            .from('records')
            .select('players!inner(country)')
            .match({ userid: record.userid, levelid: record.levelid })
            .single()
        if (!data) data = record
        else data = data.players
        console.log(user, data)
        if (data.country != user.country) {
            res.status(403).send({
                'error': 'Country does not match'
            })
            return
        }
        var { data, error } = await supabase
            .from('levels')
            .select('name')
            .match({id: record.levelid})
            .single()
        var lvName = data.name
        var { data, error } = await supabase
            .from('players')
            .select('name')
            .match({uid: record.userid})
            .single()
        var playerName = data.name
        sendLog(`${user.name} (${user.uid}) modified ${playerName}'s (${record.userid}) ${lvName} (${record.levelid}) record`)
        delete record.players
        delete record.levels
        delete record.country
        var { data, error } = await supabase
            .from('records')
            .upsert(record)
        if (error) {
            res.status(500).send(error)
            console.log(error)
            return
        }
        res.status(200).send(data)
    })

})
app.delete('/record/:userid/:levelid', async (req, res) => {
    const { token } = req.body
    checkAdmin(token).then(async (user) => {
        if (!user.isAdmin) {
            res.status(401).send({
                'error': 'Token Invalid'
            })
            return
        }
        const { userid, levelid } = req.params
        var { data, error } = await supabase
            .from('records')
            .select('*, players!inner(name, uid, country), levels!inner(name, id)')
            .match({ userid: userid, levelid: levelid })
            .single()
        if (data.players.country != user.country) {
            res.status(403).send({
                'error': 'Country does not match'
            })
            return
        }
        sendLog(`${user.name} (${user.uid}) deleted ${data.players.name}'s (${data.players.uid}) ${data.levels.name} (${data.levels.id}) record`)
        var { data, error } = await supabase
            .from('records')
            .delete()
            .match({ userid: userid, levelid: levelid })
        if (error) {
            res.status(500).send(error)
            return
        }
        
        res.status(200).send({})
    })
})
app.post('/player', async (req, res) => {
    var { token } = req.body
    checkAdmin(token).then(async (user) => {
        if (!user.isAdmin) {
            res.status(401).send({
                'error': 'Token Invalid'
            })
            return
        }
        player = req.body.data
        var { data, error } = await supabase.from("players").insert(player)
        if (error) {
            res.status(500).send(error)
            return
        }
        res.status(200).send({
            message: 'ok'
        })
    })
})
app.post('/submit/:newLevel', async (req, res) => {
    console.log('received')
    var newLevel = parseInt(req.params.newLevel)
    req.body['isChecked'] = false
    var { data, error } = await supabase
        .from("records")
        .select('progress, isChecked, refreshRate')
        .match({userid: req.body.userid, levelid: req.body.levelid})
        .single()
    console.log(data, error)
    if(data && data.isChecked){
        if (data.progress > req.body.progress) {
            res.status(400).send({
                error: 'Record is already exists. Submission cancelled'
            })
            return
        }
        if (data.progress == req.body.progress && data.refreshRate <= req.body.refreshRate){
            res.status(400).send({
                error: 'Record is already exists. Submission cancelled'
            })
            return
        }

    }
    var { data, error } = await supabase.from("records").upsert(req.body);
    console.log(data, error)
    if (error) {
        if (newLevel) {
            const apilv = await getLevel(req.body.levelid)
            const creator = await getCreator(apilv.creatorUserID)
            const lv = {
                id: req.body.levelid,
                name: apilv.name,
                creator: creator.nick
            }
            var { data, error } = await supabase
                .from('levels')
                .insert(lv)
            if(error){
                res.status(400).send({
                    error: 'Level is already exists. Submission cancelled'
                })
                return
            }
            var { data, error } = await supabase.from("records").upsert(req.body);
            res.status(200).send({ data: data, error: error })
            const { count } = await supabase
                .from('records')
                .select('isChecked', { count: 'exact', head: true })
                .is('isChecked', false)
            sendLog(`Total submission (all list, include not placed level): ${count} (New level!)`, process.env.DISCORD_WEBHOOK_ALT)
        }
        else res.status(400).send({ data: data, error: error })
    }
    else {
        res.status(200).send({ data: data, error: error })
        const { count } = await supabase
            .from('records')
            .select('isChecked', { count: 'exact', head: true })
            .is('isChecked', false)
        sendLog(`Total submission (all list, include not placed level): ${count}`, process.env.DISCORD_WEBHOOK_ALT)
    }
})
app.patch('/refreshList', async (req, res) => {
    const { token } = req.body
    checkAdmin(token).then(async (user) => {
        if (!user.isAdmin) {
            res.status(401).send({
                'error': 'Token Invalid'
            })
            return
        }
        var { error } = await supabase.rpc('updateRank')
        var { error } = await supabase.rpc('updateList')
        console.log(error)
        res.status(200).send(error)
    })
})
app.listen(
    PORT,
    () => {
        console.log(`Local development server running on http://localhost:${PORT}`)
    }
)