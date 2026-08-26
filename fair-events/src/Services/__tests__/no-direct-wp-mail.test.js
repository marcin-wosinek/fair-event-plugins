/**
 * Guards EmailService::deliver() as the sole wp_mail() call site in
 * fair-events/src. A new send path that calls wp_mail() directly bypasses the
 * fair-audience-presence guard centralized in SignupEmailHooks — see #1360.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const srcDir = resolve( __dirname, '..', '..' );
const FUNCTION_PATTERN = /function\s+&?(\w+)\s*\(/;

function collectPhpFiles( dir ) {
	const files = [];
	for ( const entry of readdirSync( dir, { withFileTypes: true } ) ) {
		if (
			entry.name === 'build' ||
			entry.name === 'vendor' ||
			entry.name === 'node_modules'
		) {
			continue;
		}

		const entryPath = join( dir, entry.name );
		if ( entry.isDirectory() ) {
			files.push( ...collectPhpFiles( entryPath ) );
		} else if ( entry.name.endsWith( '.php' ) ) {
			files.push( entryPath );
		}
	}
	return files;
}

function enclosingFunctionName( lines, lineIndex ) {
	for ( let i = lineIndex; i >= 0; i-- ) {
		const match = lines[ i ].match( FUNCTION_PATTERN );
		if ( match ) {
			return match[ 1 ];
		}
	}
	return null;
}

test( 'wp_mail() is only called inside EmailService::deliver()', () => {
	const callSites = [];

	for ( const filePath of collectPhpFiles( srcDir ) ) {
		const lines = readFileSync( filePath, 'utf8' ).split( '\n' );
		lines.forEach( ( line, index ) => {
			if ( /\bwp_mail\(\s*[^)\s]/.test( line ) ) {
				callSites.push( {
					location: `${ filePath }:${ index + 1 }`,
					enclosingFunction: enclosingFunctionName( lines, index ),
					isEmailService: filePath.endsWith( 'EmailService.php' ),
				} );
			}
		} );
	}

	expect( callSites ).toHaveLength( 1 );
	expect( callSites[ 0 ].isEmailService ).toBe( true );
	expect( callSites[ 0 ].enclosingFunction ).toBe( 'deliver' );
} );
