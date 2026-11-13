<?php
/**
 * Wording of the shared-library notices (#2181).
 *
 * @package FairFinance
 */

namespace FairFinance\Core;

defined( 'WPINC' ) || die;

/**
 * Translated templates for the notices Fair_Events_Shared_Loader shows.
 *
 * The loader lives in the shared package, which carries no translatable
 * strings; it asks one registered plugin for these at render time.
 */
class SharedLibraryMessages {

	/**
	 * Return a notice template.
	 *
	 * @param string $id    Message id: conflict, conflict_unknown or outdated.
	 * @param int    $count Number of plugins the message lists first.
	 * @return string sprintf template.
	 */
	public static function message( $id, $count ) {
		$count = (int) $count;

		switch ( $id ) {
			case 'conflict':
				/* translators: 1: paused plugin names, e.g. "Fair Events", 2: names of the plugins whose outdated copy loaded first, e.g. "Fair Timetable". */
				return _n(
					'%1$s is paused on this page because %2$s loaded an outdated copy of the Fair Event Plugins shared library first. Update %2$s, then reload this page.',
					'%1$s are paused on this page because %2$s loaded an outdated copy of the Fair Event Plugins shared library first. Update %2$s, then reload this page.',
					$count,
					'fair-finance'
				);
			case 'conflict_unknown':
				/* translators: %1$s: paused plugin names, e.g. "Fair Events". */
				return _n(
					'%1$s is paused on this page because another plugin loaded an outdated copy of the Fair Event Plugins shared library first. Update all Fair plugins, then reload this page.',
					'%1$s are paused on this page because another plugin loaded an outdated copy of the Fair Event Plugins shared library first. Update all Fair plugins, then reload this page.',
					$count,
					'fair-finance'
				);
			case 'outdated':
				/* translators: %1$s: plugin name, e.g. "Fair Timetable". */
				return _n(
					'%1$s includes an outdated copy of the Fair Event Plugins shared library. Update %1$s to keep all Fair plugins working correctly.',
					'%1$s include outdated copies of the Fair Event Plugins shared library. Update %1$s to keep all Fair plugins working correctly.',
					$count,
					'fair-finance'
				);
		}

		return '';
	}
}
