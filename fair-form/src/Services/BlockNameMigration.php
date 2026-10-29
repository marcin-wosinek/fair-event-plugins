<?php
/**
 * Block Name Migration
 *
 * @package FairForm
 */

namespace FairForm\Services;

use FairForm\Hooks\BlockHooks;

defined( 'WPINC' ) || die;

/**
 * Rewrites stored block markup from the legacy fair-audience/fair-form*
 * block names to the canonical fair-form/fair-form* names (#1161).
 *
 * Covers every row of the posts table whatever its type or status: posts,
 * pages, drafts, revisions, synced patterns, templates and template parts.
 * Only the block delimiters of the sixteen names in BlockHooks::LEGACY_NAMES
 * change; attributes and all other markup stay byte-for-byte the same.
 *
 * Content inside the removed fair-audience/event-signup block is left alone:
 * Fair Audience versions before #1161 only recognize the legacy file-upload
 * name when they refuse to render such a form, so those posts keep their
 * legacy names, which the aliases still render.
 *
 * Restartable and idempotent: runs a batch per request in ascending post ID
 * order, remembering the last post handled, and marks itself done once a
 * batch finds nothing left. A post is written only if its content still
 * matches what was read, so an edit saved meanwhile is never overwritten
 * (that post then keeps whatever names the editor saved). Content that
 * arrives later with legacy names (imports, restored revisions or backups)
 * renders through the aliases and converts when edited.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class BlockNameMigration {

	/**
	 * Option set once every post has been examined.
	 */
	const DONE_OPTION = 'fair_form_block_names_migrated';

	/**
	 * Option holding the ID of the last post examined.
	 */
	const CURSOR_OPTION = 'fair_form_block_names_cursor';

	/**
	 * Posts examined per request.
	 */
	const BATCH_SIZE = 50;

	/**
	 * Run one batch unless the migration is finished.
	 *
	 * @return void
	 */
	public static function maybe_run() {
		if ( get_option( self::DONE_OPTION ) ) {
			return;
		}

		if ( self::run_batch( self::BATCH_SIZE ) ) {
			update_option( self::DONE_OPTION, gmdate( 'Y-m-d H:i:s' ) );
			delete_option( self::CURSOR_OPTION );
		}
	}

	/**
	 * Rewrite up to $limit posts that still contain legacy block names.
	 *
	 * @param int $limit Maximum posts to examine.
	 * @return bool True when no post is left to examine.
	 */
	public static function run_batch( $limit ) {
		global $wpdb;

		$cursor = (int) get_option( self::CURSOR_OPTION, 0 );

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT ID, post_content FROM %i
				 WHERE ID > %d
				 AND post_content LIKE %s
				 AND post_content NOT LIKE %s
				 ORDER BY ID ASC
				 LIMIT %d',
				$wpdb->posts,
				$cursor,
				'%' . $wpdb->esc_like( 'wp:fair-audience/fair-form' ) . '%',
				'%' . $wpdb->esc_like( 'wp:fair-audience/event-signup' ) . '%',
				(int) $limit
			)
		);

		if ( ! is_array( $rows ) || '' !== $wpdb->last_error ) {
			return false;
		}

		foreach ( $rows as $row ) {
			$content = self::rewrite_content( $row->post_content );

			if ( null !== $content && $content !== $row->post_content ) {
				$updated = $wpdb->query(
					$wpdb->prepare(
						'UPDATE %i SET post_content = %s WHERE ID = %d AND post_content = %s',
						$wpdb->posts,
						$content,
						(int) $row->ID,
						$row->post_content
					)
				);

				if ( false === $updated ) {
					// Retry this post on the next request.
					update_option( self::CURSOR_OPTION, $cursor, false );
					return false;
				}

				if ( $updated ) {
					clean_post_cache( (int) $row->ID );
				}
			}

			$cursor = (int) $row->ID;
		}

		update_option( self::CURSOR_OPTION, $cursor, false );

		return count( $rows ) < (int) $limit;
	}

	/**
	 * Rename the legacy Fair Form block delimiters in serialized content.
	 *
	 * Only exact legacy names are renamed, in opening, closing and
	 * self-closing delimiters; a block delimiter always has whitespace after
	 * the name.
	 *
	 * @param string $content Serialized block content.
	 * @return string|null Rewritten content, or null when it could not be
	 *                     processed.
	 */
	public static function rewrite_content( $content ) {
		return preg_replace_callback(
			'#(<!--\s+/?wp:)(fair-audience/fair-form[a-z-]*)(?=\s)#',
			static function ( $matches ) {
				return $matches[1] . BlockHooks::canonical_name( $matches[2] );
			},
			$content
		);
	}
}
