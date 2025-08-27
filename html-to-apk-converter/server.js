const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const archiver = require('archiver');
const cors = require('cors');

const app = express();
const port = 3000;

// Get the user data path from environment or use default
const userDataPath = process.env.USER_DATA_PATH || path.join(__dirname, 'data');

// Create necessary directories
const uploadsDir = path.join(userDataPath, 'uploads');
const projectsDir = path.join(userDataPath, 'projects');
const outputDir = path.join(userDataPath, 'output');

[uploadsDir, projectsDir, outputDir].forEach(dir => {
  fs.ensureDirSync(dir);
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(uploadsDir, req.body.projectId || 'temp');
    fs.ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

// Routes
app.post('/api/upload', upload.array('files'), (req, res) => {
  res.json({ success: true, message: 'Files uploaded successfully' });
});

app.post('/api/build', async (req, res) => {
  try {
    const { projectId, config } = req.body;
    
    // Create project directory
    const projectDir = path.join(projectsDir, projectId);
    const buildDir = path.join(projectDir, 'build');
    fs.ensureDirSync(buildDir);
    
    // Copy uploaded files to project directory
    const uploadDir = path.join(uploadsDir, projectId);
    if (fs.existsSync(uploadDir)) {
      fs.copySync(uploadDir, path.join(projectDir, 'www'));
    }
    
    // Create Cordova project
    await executeCommand(`cordova create ${buildDir} ${config.packageName} "${config.appName}"`);
    
    // Add Android platform
    await executeCommand(`cd ${buildDir} && cordova platform add android`);
    
    // Copy www files
    fs.copySync(path.join(projectDir, 'www'), path.join(buildDir, 'www'));
    
    // Add plugins
    if (config.plugins && config.plugins.length > 0) {
      for (const plugin of config.plugins) {
        await executeCommand(`cd ${buildDir} && cordova plugin add ${plugin}`);
      }
    }
    
    // Update config.xml with app settings
    const configXmlPath = path.join(buildDir, 'config.xml');
    let configXml = fs.readFileSync(configXmlPath, 'utf8');
    
    // Update app name
    configXml = configXml.replace(/<name>.*?<\/name>/, `<name>${config.appName}</name>`);
    
    // Update preferences
    let preferences = '';
    if (config.orientation) preferences += `<preference name="Orientation" value="${config.orientation}" />`;
    if (config.fullscreen) preferences += `<preference name="Fullscreen" value="${config.fullscreen}" />`;
    if (config.theme) preferences += `<preference name="BackgroundColor" value="${config.theme === 'dark' ? '#000000' : '#FFFFFF'}" />`;
    
    configXml = configXml.replace('</widget>', preferences + '</widget>');
    
    fs.writeFileSync(configXmlPath, configXml);
    
    // Build the APK
    const buildCommand = config.buildType === 'release' 
      ? `cd ${buildDir} && cordova build android --release`
      : `cd ${buildDir} && cordova build android`;
      
    await executeCommand(buildCommand);
    
    // Find the built APK
    const apkPath = config.buildType === 'release'
      ? path.join(buildDir, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
      : path.join(buildDir, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
      
    // Copy APK to output directory
    const outputApkPath = path.join(outputDir, `${projectId}-${config.version || '1.0.0'}-${config.buildType}.apk`);
    fs.copyFileSync(apkPath, outputApkPath);
    
    // Clean up temporary files
    fs.removeSync(uploadDir);
    
    res.json({ 
      success: true, 
      apkPath: `/output/${path.basename(outputApkPath)}`,
      message: 'APK built successfully' 
    });
  } catch (error) {
    console.error('Build error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/projects', (req, res) => {
  const projects = [];
  
  if (fs.existsSync(projectsDir)) {
    const projectFolders = fs.readdirSync(projectsDir);
    
    projectFolders.forEach(folder => {
      const projectPath = path.join(projectsDir, folder);
      const stats = fs.statSync(projectPath);
      
      if (stats.isDirectory()) {
        projects.push({
          id: folder,
          name: folder,
          created: stats.birthtime,
          modified: stats.mtime
        });
      }
    });
  }
  
  res.json(projects);
});

app.get('/output/:filename', (req, res) => {
  const filePath = path.join(outputDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// Helper function to execute shell commands
function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Command error: ${error}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`Command stderr: ${stderr}`);
      }
      console.log(`Command stdout: ${stdout}`);
      resolve(stdout);
    });
  });
}

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});