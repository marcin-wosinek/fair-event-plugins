<?php
/**
 * Instagram Cleanup Hooks
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Hooks;

use FairAudienceExperimental\API\InstagramPostsController;

defined( 'WPINC' ) || die;

/**
 * Safety-net cron sweep for temporary Instagram-upload attachments.
 *
 * The upload and publish endpoints clean these up in the normal flow (publish
 * success deletes them, publish failure keeps them for retry), but an
 * abandoned publish (browser closed mid-flow, request timeout) can leave one
 * behind. This sweeps anything still tagged as temporary after the retry
 * window has passed.
 */
class InstagramCleanupHooks {

	/**
	 * Cron hook name.
	 */
	const CRON_HOOK = 'fair_audience_cleanup_instagram_temp_attachments';

	/**
	 * How long a temporary attachment is kept before the sweep removes it.
	 */
	const STALE_HOURS = 24;

	/**
	 * Initialize hooks.
	 */
	public static function init() {
		add_action( self::CRON_HOOK, array( static::class, 'sweep' ) );
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', self::CRON_HOOK );
		}
	}

	/**
	 * Delete temporary Instagram attachments older than the stale threshold.
	 */
	public static function sweep() {
		$cutoff = gmdate( 'Y-m-d H:i:s', time() - self::STALE_HOURS * HOUR_IN_SECONDS );

		$attachment_ids = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'posts_per_page' => 50,
				'fields'         => 'ids',
				'date_query'     => array(
					array( 'before' => $cutoff ),
				),
				'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- Bounded, hourly cron sweep; no user-facing request depends on this.
					array(
						'key'   => InstagramPostsController::TEMP_ATTACHMENT_META_KEY,
						'value' => 1,
					),
				),
			)
		);

		foreach ( $attachment_ids as $attachment_id ) {
			wp_delete_attachment( $attachment_id, true );
		}
	}
}
