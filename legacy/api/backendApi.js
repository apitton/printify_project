const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;
const path=require('path');
const { Client } = require('pg');
const fs = require('fs');

// Allow your frontend to access the backend (add basic CORS)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // You can restrict this to your domain
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  express.json({ limit: '10mb' });
  express.urlencoded({ extended: true, limit: '10mb' });
  next();
});

app.use(express.json({ limit: '30mb' })); 
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

app.use(express.json());
app.post('/api/data', async (req, res) => {
  try {
    //console.log("req ",req);
    const targetUrl=req.body.url;
    console.log("target url ",targetUrl);
    const headers=req.body.headers ||{};
    console.log("headers ",headers);    
    const body=req.body.body || {};    
    console.log("body ",body);    
    const method = req.body.method;
    console.log("method: ", method)
    const response = await axios({method: method, url: targetUrl, headers:headers, data: body});
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching external API:", error.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

app.post('/api/movefile', async (req, res) => {  
  console.log("req :",req);
  console.log('file move requested', req.body)
  const initialPath = path.normalize(req.body.initialPath);
  const newPath = path.normalize(req.body.newPath);
  console.log('file move requested', initialPath, newPath);
  fs.rename(initialPath, newPath, (err) => {
    if (err) {
      console.log("File move failed ", err);
      return res.status(500).json({error: 'File move failed', details: err.message});
    }
    console.log("File moved successfully")
    res.json({success: true, message: 'File moved successfully'});
  });    
})

const dirName = "C:\\Users\\antoi\\Documents\\printify\\app";
app.use(express.static(dirName));

app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
});
