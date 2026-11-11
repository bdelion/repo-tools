import { runLibrarySelection } from './library-generate';

runLibrarySelection(process.argv.slice(2), 'impact').catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
