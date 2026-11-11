<?php
/**
 * Legacy feed preferences
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\FeedModeConversion;

defined( 'WPINC' ) || die;

/**
 * How weekly preferences recorded under the legacy feed modes ('all' and
 * 'selected') map onto explicit feed subscriptions.
 *
 * There are two paths, and they must stay distinct:
 *
 * - Same-site upgrade ({@see self::for_same_site_upgrade()}, used by
 *   {@see FeedModeConversion}): feed IDs belong to this site, so a
 *   participant who was receiving every weekly email is subscribed to the
 *   feeds eligible when the conversion started.
 * - Cross-site import ({@see self::for_import()}, the contract for the CSV
 *   migration in #2218): feed IDs from another site mean nothing here, so
 *   both legacy modes create no destination subscriptions. General marketing
 *   consent and the weekly opt-out carry over independently, and the
 *   destination feeds must be chosen explicitly.
 */
class LegacyFeedPreferences {

	/**
	 * Feeds a same-site legacy participant gets when converted.
	 *
	 * @param array $participant Row with weekly_feed_mode, email_profile, status, weekly_summary_opt_out.
	 * @param int[] $snapshot    Feeds eligible when the conversion started.
	 * @return int[] Feeds to add; existing subscriptions are kept separately.
	 */
	public static function for_same_site_upgrade( array $participant, array $snapshot ): array {
		if ( WeeklyFeeds::LEGACY_MODE_ALL !== ( $participant['weekly_feed_mode'] ?? '' ) ) {
			return array();
		}

		return FeedModeConversion::was_receiving( $participant ) ? array_values( array_map( 'intval', $snapshot ) ) : array();
	}

	/**
	 * Transferable weekly preferences of a row imported from another site.
	 *
	 * The legacy feed mode alone is not a preference to compare: rows that
	 * differ only in it normalize to the same result. The result never
	 * carries feed subscriptions, so an import neither creates nor changes
	 * the destination's subscriptions.
	 *
	 * @param array $row Imported row: email_profile, weekly_summary_opt_out and optionally
	 *                   weekly_feed_mode and feed IDs, which are ignored.
	 * @return array{email_profile: string, weekly_summary_opt_out: bool, feed_ids: int[], feeds_need_selection: bool}
	 *     Normalized preferences; `feeds_need_selection` tells the importer to report that
	 *     destination feeds must be chosen explicitly.
	 */
	public static function for_import( array $row ): array {
		$profile = (string) ( $row['email_profile'] ?? 'minimal' );

		return array(
			'email_profile'          => in_array( $profile, array( 'minimal', 'marketing', 'declined' ), true ) ? $profile : 'minimal',
			'weekly_summary_opt_out' => ! empty( $row['weekly_summary_opt_out'] ),
			'feed_ids'               => array(),
			'feeds_need_selection'   => true,
		);
	}
}
