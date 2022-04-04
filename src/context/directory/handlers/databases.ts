import path from 'path';
import fs from 'fs-extra';
import { constants, loadFileAndReplaceKeywords } from '../../../tools';

import log from '../../../logger';
import {
  isDirectory,
  existsMustBeDir,
  dumpJSON,
  loadJSON,
  sanitize,
  mapClientID2NameSorted
} from '../../../utils';

import { DirectoryHandler } from '.'
import DirectoryContext from '..';

type ParsedDatabases = {
  databases: unknown[] | undefined
}

type DatabaseMetadata = {
  options?: {
    customScripts?: {
      change_password: string
      create: string
      delete: string
      get_user: string
      login: string
      verify: string
    },
  }
}


function getDatabase(folder: string, mappings): {} {
  const metaFile = path.join(folder, 'database.json');

  const metaData: DatabaseMetadata | {} = (() => {
    try {
      return loadJSON(metaFile, mappings);
    } catch (err) {
      log.warn(`Skipping database folder ${folder} as cannot find or read ${metaFile}`);
      return {};
    }
  })()


  if (!metaData) {
    log.warn(`Skipping database folder ${folder} as ${metaFile} is empty`);
    return {};
  }

  const database = {
    ...metaData,
    options: {
      //@ts-ignore because this code exists currently, but still needs to be understood if it is correct or not
      ...metaData.options,
      //@ts-ignore because this code exists currently, but still needs to be understood if it is correct or not
      ...(metaData.customScripts && { customScripts: metaData.customScripts })
    }
  };

  // If any customScripts configured then load content of files
  if (database.options.customScripts) {
    Object.entries(database.options.customScripts).forEach(([name, script]) => {
      if (!constants.DATABASE_SCRIPTS.includes(name)) {
        // skip invalid keys in customScripts object
        log.warn('Skipping invalid database configuration: ' + name);
      } else {
        database.options.customScripts[name] = loadFileAndReplaceKeywords(
          //@ts-ignore
          path.join(folder, script),
          mappings
        );
      }
    });
  }

  return database;
}

function parse(context: DirectoryContext): ParsedDatabases {
  const databaseFolder = path.join(context.filePath, constants.DATABASE_CONNECTIONS_DIRECTORY);
  if (!existsMustBeDir(databaseFolder)) return { databases: undefined }; // Skip

  const folders = fs.readdirSync(databaseFolder)
    .map((f) => path.join(databaseFolder, f))
    .filter((f) => isDirectory(f));

  const databases = folders.map((f) => getDatabase(f, context.mappings))
    .filter((p) => Object.keys(p).length > 1);

  return {
    databases
  };
}

async function dump(context: DirectoryContext): Promise<void> {
  const { databases } = context.assets;

  if (!databases) return; // Skip, nothing to dump

  const databasesFolder = path.join(context.filePath, constants.DATABASE_CONNECTIONS_DIRECTORY);
  fs.ensureDirSync(databasesFolder);

  databases.forEach((database) => {
    const dbFolder = path.join(databasesFolder, sanitize(database.name));
    fs.ensureDirSync(dbFolder);

    const sortCustomScripts = (name1: string, name2: string): 1 | 0 | -1 => {
      if (name1 === name2) return 0;
      return name1 > name2 ? 1 : -1;
    };

    const formatted = {
      ...database,
      ...(database.enabled_clients && { enabled_clients: mapClientID2NameSorted(database.enabled_clients, context.assets.clientsOrig) }),
      options: {
        ...database.options,
        // customScripts option only written if there are scripts
        ...(database.options.customScripts && {
          //@ts-ignore
          customScripts: Object.entries(database.options.customScripts).sort(sortCustomScripts).reduce((scripts, [name, script]) => {
            // Dump custom script to file
            const scriptName = sanitize(`${name}.js`);
            const scriptFile = path.join(dbFolder, scriptName);
            log.info(`Writing ${scriptFile}`);
            fs.writeFileSync(scriptFile, script);
            scripts[name] = `./${scriptName}`;
            return scripts;
          }, {})
        })
      }
    };

    const databaseFile = path.join(dbFolder, 'database.json');
    dumpJSON(databaseFile, formatted);
  });
}

const databasesHandler: DirectoryHandler<ParsedDatabases> = {
  parse,
  dump,
}

export default databasesHandler;