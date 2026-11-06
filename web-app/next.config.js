'use strict';
const path=require('node:path');
const deps=process.env.MELODIA_NEXT_DEPENDENCIES?path.resolve(process.env.MELODIA_NEXT_DEPENDENCIES):null;
module.exports={output:'export',trailingSlash:true,poweredByHeader:false,reactStrictMode:true,productionBrowserSourceMaps:false,experimental:{cpus:1,externalDir:true},typescript:{tsconfigPath:deps?'.tooling/tsconfig.external.json':'tsconfig.json'},webpack(config){if(deps){config.resolve.modules=[...(config.resolve.modules||[]),deps];config.resolveLoader.modules=[...(config.resolveLoader.modules||[]),deps];}return config;}};
