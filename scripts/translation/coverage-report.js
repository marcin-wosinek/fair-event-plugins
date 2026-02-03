#!/usr/bin/env node

/**
 * Translation Coverage Report
 *
 * Generates comprehensive translation coverage statistics across all plugins and languages.
 *
 * Usage:
 *   node scripts/translation/coverage-report.js
 *   node scripts/translation/coverage-report.js --output=coverage.json
 *   node scripts/translation/coverage-report.js --markdown > TRANSLATION_STATUS.md
 *   node scripts/translation/coverage-report.js --plugin=fair-events
 */

import { writeFile, access } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { parsePOFile, isUntranslated } from './lib/po-parser.js';
import { config } from './config.js';

const __filename = fileURLToPath( import.meta.url );
const __dirname = dirname( __filename );
const rootDir = join( __dirname, '../..' );

/**
 * Parse CLI arguments
 */
function parseArgs() {
	const args = process.argv.slice( 2 );
	const options = {
		plugin: null,
		output: null,
		markdown: false,
	};

	for ( const arg of args ) {
		if ( arg.startsWith( '--plugin=' ) ) {
			options.plugin = arg.substring( '--plugin='.length );
		} else if ( arg.startsWith( '--output=' ) ) {
			options.output = arg.substring( '--output='.length );
		} else if ( arg === '--markdown' ) {
			options.markdown = true;
		}
	}

	return options;
}

/**
 * Calculate coverage for a single plugin/locale pair
 */
async function calculateCoverage( plugin, locale ) {
	const poFilePath = join( rootDir, config.paths.poFile( plugin, locale ) );

	try {
		await access( poFilePath );
	} catch {
		return null; // File doesn't exist
	}

	try {
		const parsed = await parsePOFile( poFilePath );
		const total = parsed.translations.filter(
			( t ) => ! t.isHeader
		).length;
		const untranslatedCount = parsed.translations.filter(
			( t ) => ! t.isHeader && isUntranslated( t )
		).length;
		const translated = total - untranslatedCount;

		return {
			total,
			translated,
			untranslated: untranslatedCount,
			percentage:
				total > 0
					? ( ( translated / total ) * 100 ).toFixed( 1 )
					: '0.0',
		};
	} catch ( error ) {
		console.error(
			`Warning: Failed to parse ${ poFilePath }:`,
			error.message
		);
		return null;
	}
}

/**
 * Generate full coverage report
 */
async function generateCoverageReport( options ) {
	const report = {
		generatedAt: new Date().toISOString(),
		summary: {
			totalPlugins: 0,
			totalLocales: config.locales.length,
			totalStrings: 0,
			translatedStrings: 0,
			untranslatedStrings: 0,
			overallPercentage: '0.0',
		},
		byPlugin: {},
		byLocale: {},
	};

	// Determine which plugins to process
	const plugins = options.plugin
		? config.plugins.filter( ( p ) => p.name === options.plugin )
		: config.plugins;

	report.summary.totalPlugins = plugins.length;

	// Initialize locale summaries
	for ( const locale of config.locales ) {
		report.byLocale[ locale ] = {
			localeName: config.localeNames[ locale ],
			plugins: {},
			summary: {
				totalStrings: 0,
				translatedStrings: 0,
				untranslatedStrings: 0,
				averagePercentage: '0.0',
			},
		};
	}

	// Process each plugin
	for ( const plugin of plugins ) {
		report.byPlugin[ plugin.name ] = {
			locales: {},
			summary: {
				totalStrings: 0,
				translatedStrings: 0,
				untranslatedStrings: 0,
				averagePercentage: '0.0',
			},
		};

		let localeCount = 0;
		let totalPercentage = 0;

		for ( const locale of config.locales ) {
			const coverage = await calculateCoverage( plugin.name, locale );

			if ( coverage ) {
				report.byPlugin[ plugin.name ].locales[ locale ] = coverage;
				report.byPlugin[ plugin.name ].summary.totalStrings =
					coverage.total;
				report.byPlugin[ plugin.name ].summary.translatedStrings +=
					coverage.translated;
				report.byPlugin[ plugin.name ].summary.untranslatedStrings +=
					coverage.untranslated;

				report.byLocale[ locale ].plugins[ plugin.name ] = coverage;
				report.byLocale[ locale ].summary.totalStrings +=
					coverage.total;
				report.byLocale[ locale ].summary.translatedStrings +=
					coverage.translated;
				report.byLocale[ locale ].summary.untranslatedStrings +=
					coverage.untranslated;

				totalPercentage += parseFloat( coverage.percentage );
				localeCount++;
			}
		}

		if ( localeCount > 0 ) {
			report.byPlugin[ plugin.name ].summary.averagePercentage = (
				totalPercentage / localeCount
			).toFixed( 1 );
		}
	}

	// Calculate locale averages
	for ( const locale of Object.keys( report.byLocale ) ) {
		const localeData = report.byLocale[ locale ];

		if ( localeData.summary.totalStrings > 0 ) {
			localeData.summary.averagePercentage = (
				( localeData.summary.translatedStrings /
					localeData.summary.totalStrings ) *
				100
			).toFixed( 1 );
		}
	}

	// Calculate overall summary
	for ( const pluginData of Object.values( report.byPlugin ) ) {
		report.summary.totalStrings += pluginData.summary.totalStrings;
		report.summary.translatedStrings +=
			pluginData.summary.translatedStrings;
		report.summary.untranslatedStrings +=
			pluginData.summary.untranslatedStrings;
	}

	if ( report.summary.totalStrings > 0 ) {
		report.summary.overallPercentage = (
			( report.summary.translatedStrings / report.summary.totalStrings ) *
			100
		).toFixed( 1 );
	}

	return report;
}

/**
 * Generate markdown report
 */
function generateMarkdown( report ) {
	let md = '# Translation Coverage Report\n\n';
	md += `Generated: ${ new Date( report.generatedAt ).toLocaleString() }\n\n`;

	// Overall Summary
	md += '## Overall Summary\n\n';
	md += `- **Total Plugins**: ${ report.summary.totalPlugins }\n`;
	md += `- **Total Locales**: ${ report.summary.totalLocales }\n`;
	md += `- **Total Strings**: ${ report.summary.totalStrings }\n`;
	md += `- **Translated**: ${ report.summary.translatedStrings } (${ report.summary.overallPercentage }%)\n`;
	md += `- **Untranslated**: ${ report.summary.untranslatedStrings }\n\n`;

	// By Plugin
	md += '## Coverage by Plugin\n\n';
	md += '| Plugin | Strings | Avg Coverage |\n';
	md += '|--------|---------|-------------|\n';

	for ( const [ pluginName, data ] of Object.entries( report.byPlugin ) ) {
		md += `| ${ pluginName } | ${ data.summary.totalStrings } | ${ data.summary.averagePercentage }% |\n`;
	}
	md += '\n';

	// By Locale
	md += '## Coverage by Locale\n\n';
	md += '| Locale | Language | Strings | Coverage |\n';
	md += '|--------|----------|---------|----------|\n';

	for ( const [ locale, data ] of Object.entries( report.byLocale ) ) {
		md += `| ${ locale } | ${ data.localeName } | ${ data.summary.totalStrings } | ${ data.summary.averagePercentage }% |\n`;
	}
	md += '\n';

	// Detailed Plugin Breakdown
	md += '## Detailed Coverage\n\n';

	for ( const [ pluginName, pluginData ] of Object.entries(
		report.byPlugin
	) ) {
		md += `### ${ pluginName }\n\n`;
		md += '| Locale | Total | Translated | Untranslated | Coverage |\n';
		md += '|--------|-------|------------|--------------|----------|\n';

		for ( const [ locale, coverage ] of Object.entries(
			pluginData.locales
		) ) {
			md += `| ${ locale } (${ config.localeNames[ locale ] }) | ${ coverage.total } | ${ coverage.translated } | ${ coverage.untranslated } | ${ coverage.percentage }% |\n`;
		}
		md += '\n';
	}

	return md;
}

/**
 * Main execution
 */
async function main() {
	const options = parseArgs();

	console.error( '📊 Generating translation coverage report...\n' );

	try {
		const report = await generateCoverageReport( options );

		if ( options.markdown ) {
			const md = generateMarkdown( report );

			if ( options.output ) {
				await writeFile( options.output, md, 'utf8' );
				console.error(
					`✅ Markdown report saved to ${ options.output }`
				);
			} else {
				console.log( md );
			}
		} else {
			const output = JSON.stringify( report, null, 2 );

			if ( options.output ) {
				await writeFile( options.output, output, 'utf8' );
				console.error( `✅ JSON report saved to ${ options.output }` );
			} else {
				console.log( output );
			}
		}

		console.error(
			`\n✅ Overall coverage: ${ report.summary.overallPercentage }% (${ report.summary.translatedStrings }/${ report.summary.totalStrings } strings)`
		);
	} catch ( error ) {
		console.error( `❌ Error: ${ error.message }` );
		process.exit( 1 );
	}
}

main();
