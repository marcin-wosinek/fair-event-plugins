<?php
/**
 * Wording of the administrator email sent while Fair Events is paused (#2445).
 *
 * @package FairEvents
 */

namespace FairEvents\Core;

use FairEvents\Services\PaymentHistoryUpgrade;

defined( 'WPINC' ) || die;

/**
 * Plain-text alert: which site, why Fair Events is paused, what stops
 * working, and how to recover. It repeats the guidance of the admin
 * notices (SharedLibraryMessages, PaymentHistoryUpgrade) and carries only
 * plugin names and known blocker labels: no paths, loader output,
 * credentials, participant or payment details.
 */
class PauseAlertMessage {

	/**
	 * Build the email.
	 *
	 * @param string $cause     PauseAlert::CAUSE_* constant.
	 * @param array  $diagnosis Incident diagnosis.
	 * @return array{subject: string, body: string}
	 */
	public static function compose( $cause, array $diagnosis ) {
		$site_name = wp_specialchars_decode( (string) get_option( 'blogname', '' ), ENT_QUOTES );
		$site_url  = home_url( '/' );
		if ( '' === trim( $site_name ) ) {
			$site_name = $site_url;
		}

		$subject = sprintf(
			/* translators: %s: site name */
			__( '[%s] Fair Events is paused', 'fair-events' ),
			$site_name
		);

		$lines   = array();
		$lines[] = sprintf(
			/* translators: 1: site name, 2: site address */
			__( 'Fair Events is paused on your website %1$s (%2$s).', 'fair-events' ),
			$site_name,
			$site_url
		);
		$lines[] = '';

		if ( PauseAlert::CAUSE_LIBRARY === $cause ) {
			$lines = array_merge( $lines, self::library_lines( $diagnosis ) );
		} else {
			$lines = array_merge( $lines, self::migration_lines( $diagnosis ) );
		}

		$lines[] = '';
		$lines[] = sprintf(
			/* translators: %s: address of the WordPress Plugins screen */
			__( 'Plugins screen: %s', 'fair-events' ),
			admin_url( 'plugins.php' )
		);
		$lines[] = '';
		$lines[] = __( 'This alert goes to the website’s administration email address. You won’t get another one for this pause unless it is resolved and happens again.', 'fair-events' );

		return array(
			'subject' => $subject,
			'body'    => implode( "\n", $lines ),
		);
	}

	/**
	 * Reason, impact and recovery for a shared-library conflict.
	 *
	 * @param array $diagnosis responsible (plugin names), unknown (bool).
	 * @return string[]
	 */
	private static function library_lines( array $diagnosis ) {
		$responsible = array_values( array_filter( array_map( 'strval', (array) ( $diagnosis['responsible'] ?? array() ) ) ) );
		$known       = ! empty( $responsible ) && empty( $diagnosis['unknown'] );

		$lines   = array();
		$lines[] = $known
			? sprintf(
				/* translators: %s: names of the plugins whose outdated copy loaded first, e.g. "Fair Timetable" */
				__( 'Reason: %s loaded an outdated copy of the Fair Event Plugins shared library before Fair Events could start.', 'fair-events' ),
				self::name_list( $responsible )
			)
			: __( 'Reason: another plugin loaded an outdated copy of the Fair Event Plugins shared library before Fair Events could start.', 'fair-events' );
		$lines[] = __( 'Impact: on the pages where this happens, Fair Events doesn’t run: event pages, calendars, signups and ticket purchases are unavailable.', 'fair-events' );
		$lines[] = '';
		$lines[] = __( 'To recover:', 'fair-events' );
		$lines[] = '1. ' . (
			$known
				? sprintf(
					/* translators: %s: names of the plugins to update, e.g. "Fair Timetable" */
					__( 'Update %s.', 'fair-events' ),
					self::name_list( $responsible )
				)
				: __( 'Update all Fair plugins.', 'fair-events' )
		);
		$lines[] = '2. ' . __( 'Reload your website and the Plugins screen. Fair Events resumes once no outdated copy loads first.', 'fair-events' );
		return $lines;
	}

	/**
	 * Reason, impact and recovery for an unfinished migration.
	 *
	 * @param array $diagnosis blockers (codes).
	 * @return string[]
	 */
	private static function migration_lines( array $diagnosis ) {
		$labels = PaymentHistoryUpgrade::refusal_labels();

		$lines   = array();
		$lines[] = __( 'Reason: this site hasn’t finished the payment history migration, which this version of Fair Events no longer includes.', 'fair-events' );
		foreach ( (array) ( $diagnosis['blockers'] ?? array() ) as $code ) {
			if ( isset( $labels[ $code ] ) ) {
				$lines[] = '- ' . $labels[ $code ];
			}
		}
		$lines[] = __( 'Impact: Fair Events doesn’t start on any page, so event pages, signups and ticket purchases are unavailable. Nothing on this site was changed.', 'fair-events' );
		$lines[] = '';
		$lines[] = __( 'To recover:', 'fair-events' );
		foreach ( PaymentHistoryUpgrade::recovery_steps() as $index => $step ) {
			$lines[] = ( $index + 1 ) . '. ' . $step;
		}
		$lines[] = '';
		$lines[] = sprintf(
			/* translators: %s: address of the release download */
			__( 'Download the release: %s', 'fair-events' ),
			PaymentHistoryUpgrade::INTERMEDIATE_RELEASE_URL
		);
		$lines[] = sprintf(
			/* translators: %s: address of the upgrade guide */
			__( 'Read the upgrade guide: %s', 'fair-events' ),
			PaymentHistoryUpgrade::GUIDE_URL
		);
		return $lines;
	}

	/**
	 * Join plugin names for a sentence.
	 *
	 * @param string[] $names Names.
	 * @return string
	 */
	private static function name_list( array $names ) {
		return function_exists( 'wp_sprintf_l' ) ? wp_sprintf_l( '%l', $names ) : implode( ', ', $names );
	}
}
