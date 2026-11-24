<?php
/**
 * Marketing asset storage.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Models;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * Reads and writes the marketing assets of event occurrences (#2396).
 *
 * Two site-scoped tables: one row per asset, keyed by the exact event date
 * it belongs to (a generated occurrence has its own assets, never its
 * series'), and one row per linked team member, unique on
 * `(asset_id, member_id)`. An asset carries a required use-case label,
 * plain text, an optional attachment and an optional schedule item.
 *
 * Text is stored exactly as received: no trimming, no markup stripping.
 *
 * Nothing here is gated on the `marketing-assets` bundle: turning it off
 * keeps every asset, and lifecycle cleanup keeps working while it is off.
 * Callers that write wrap their calls in a transaction; see
 * {@see \FairEventsExperimental\Services\MarketingAssets}.
 */
class MarketingAssetRepository {

	/**
	 * Asset table suffix.
	 */
	public const ASSETS_TABLE = 'fair_events_marketing_assets';

	/**
	 * Member link table suffix.
	 */
	public const MEMBERS_TABLE = 'fair_events_marketing_asset_members';

	/**
	 * Schema version.
	 */
	public const DB_VERSION = '1';

	/**
	 * Option holding the installed schema version.
	 */
	public const DB_VERSION_OPTION = 'fair_events_experimental_marketing_assets_db_version';

	/**
	 * Asset table name.
	 *
	 * @return string
	 */
	public static function assets_table() {
		global $wpdb;
		return $wpdb->prefix . self::ASSETS_TABLE;
	}

	/**
	 * Member link table name.
	 *
	 * @return string
	 */
	public static function members_table() {
		global $wpdb;
		return $wpdb->prefix . self::MEMBERS_TABLE;
	}

	/**
	 * Whether the tables have been installed on this site. Lifecycle hooks
	 * check this so a site that never enabled the bundle runs no queries.
	 *
	 * @return bool
	 */
	public static function is_installed() {
		return '' !== (string) get_option( self::DB_VERSION_OPTION, '' );
	}

	/**
	 * Install or upgrade the tables when the stored version differs.
	 *
	 * @return void
	 */
	public static function maybe_install() {
		if ( self::DB_VERSION !== (string) get_option( self::DB_VERSION_OPTION, '' ) ) {
			self::install();
		}
	}

	/**
	 * Install or upgrade the tables. dbDelta keeps existing rows.
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$assets  = self::assets_table();
		$members = self::members_table();
		$charset = $wpdb->get_charset_collate();

		dbDelta(
			"CREATE TABLE {$assets} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				event_date_id bigint(20) unsigned NOT NULL,
				label varchar(191) NOT NULL,
				text mediumtext NOT NULL,
				attachment_id bigint(20) unsigned DEFAULT NULL,
				image_removed tinyint(1) unsigned NOT NULL DEFAULT 0,
				schedule_item_id bigint(20) unsigned DEFAULT NULL,
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				PRIMARY KEY  (id),
				KEY event_date_id (event_date_id),
				KEY attachment_id (attachment_id),
				KEY schedule_item_id (schedule_item_id)
			) {$charset};"
		);

		dbDelta(
			"CREATE TABLE {$members} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				asset_id bigint(20) unsigned NOT NULL,
				member_id bigint(20) unsigned NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY asset_member (asset_id,member_id),
				KEY member_id (member_id)
			) {$charset};"
		);

		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Number of assets of an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return int
	 */
	public function count_for_event_date( $event_date_id ) {
		global $wpdb;

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE event_date_id = %d',
				self::assets_table(),
				(int) $event_date_id
			)
		);
	}

	/**
	 * One page of an event date's assets, oldest first, with member IDs.
	 *
	 * @param int $event_date_id Event date ID.
	 * @param int $limit         Page size.
	 * @param int $offset        Rows to skip.
	 * @return array[] Hydrated rows.
	 */
	public function page_for_event_date( $event_date_id, $limit, $offset ) {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY id ASC LIMIT %d OFFSET %d',
				self::assets_table(),
				(int) $event_date_id,
				(int) $limit,
				(int) $offset
			),
			ARRAY_A
		);

		return $this->with_members( (array) $rows );
	}

	/**
	 * One asset with its member IDs.
	 *
	 * @param int  $id         Asset ID.
	 * @param bool $for_update Lock the row (inside a transaction).
	 * @return array|null Hydrated row, or null when it doesn't exist.
	 */
	public function find( $id, $for_update = false ) {
		global $wpdb;

		if ( $for_update ) {
			$row = $wpdb->get_row(
				$wpdb->prepare( 'SELECT * FROM %i WHERE id = %d FOR UPDATE', self::assets_table(), (int) $id ),
				ARRAY_A
			);
		} else {
			$row = $wpdb->get_row(
				$wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', self::assets_table(), (int) $id ),
				ARRAY_A
			);
		}

		if ( ! $row ) {
			return null;
		}

		$rows = $this->with_members( array( $row ) );
		return $rows[0];
	}

	/**
	 * Insert an asset row.
	 *
	 * @param array $data `event_date_id`, `label`, `text`, `attachment_id` (int|null), `schedule_item_id` (int|null).
	 * @return int New asset ID, 0 on failure.
	 */
	public function insert( array $data ) {
		global $wpdb;

		$now = current_time( 'mysql', true );
		$ok  = $wpdb->insert(
			self::assets_table(),
			array(
				'event_date_id'    => (int) $data['event_date_id'],
				'label'            => (string) $data['label'],
				'text'             => (string) $data['text'],
				'attachment_id'    => $data['attachment_id'] ? (int) $data['attachment_id'] : null,
				'image_removed'    => 0,
				'schedule_item_id' => $data['schedule_item_id'] ? (int) $data['schedule_item_id'] : null,
				'created_at'       => $now,
				'updated_at'       => $now,
			),
			array( '%d', '%s', '%s', '%d', '%d', '%d', '%s', '%s' )
		);

		return $ok ? (int) $wpdb->insert_id : 0;
	}

	/**
	 * Update an asset row. Every column is written; saving clears the
	 * "image removed" marker.
	 *
	 * @param int   $id   Asset ID.
	 * @param array $data `label`, `text`, `attachment_id` (int|null), `schedule_item_id` (int|null).
	 * @return bool
	 */
	public function update( $id, array $data ) {
		global $wpdb;

		return false !== $wpdb->update(
			self::assets_table(),
			array(
				'label'            => (string) $data['label'],
				'text'             => (string) $data['text'],
				'attachment_id'    => $data['attachment_id'] ? (int) $data['attachment_id'] : null,
				'image_removed'    => 0,
				'schedule_item_id' => $data['schedule_item_id'] ? (int) $data['schedule_item_id'] : null,
				'updated_at'       => current_time( 'mysql', true ),
			),
			array( 'id' => (int) $id ),
			array( '%s', '%s', '%d', '%d', '%d', '%s' ),
			array( '%d' )
		);
	}

	/**
	 * Replace the member links of an asset.
	 *
	 * @param int   $asset_id   Asset ID.
	 * @param int[] $member_ids Member IDs.
	 * @return bool
	 */
	public function replace_members( $asset_id, array $member_ids ) {
		global $wpdb;

		if ( false === $wpdb->delete( self::members_table(), array( 'asset_id' => (int) $asset_id ), array( '%d' ) ) ) {
			return false;
		}

		foreach ( array_values( array_unique( array_map( 'intval', $member_ids ) ) ) as $member_id ) {
			$ok = $wpdb->insert(
				self::members_table(),
				array(
					'asset_id'  => (int) $asset_id,
					'member_id' => $member_id,
				),
				array( '%d', '%d' )
			);
			if ( ! $ok ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Delete an asset and its member links.
	 *
	 * @param int $id Asset ID.
	 * @return bool
	 */
	public function delete( $id ) {
		global $wpdb;

		if ( false === $wpdb->delete( self::members_table(), array( 'asset_id' => (int) $id ), array( '%d' ) ) ) {
			return false;
		}

		return false !== $wpdb->delete( self::assets_table(), array( 'id' => (int) $id ), array( '%d' ) );
	}

	/**
	 * Delete every asset of an event date, with their member links.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return bool
	 */
	public function delete_for_event_date( $event_date_id ) {
		global $wpdb;

		$links = $wpdb->query(
			$wpdb->prepare(
				'DELETE m FROM %i AS m INNER JOIN %i AS a ON a.id = m.asset_id WHERE a.event_date_id = %d',
				self::members_table(),
				self::assets_table(),
				(int) $event_date_id
			)
		);
		if ( false === $links ) {
			return false;
		}

		return false !== $wpdb->delete( self::assets_table(), array( 'event_date_id' => (int) $event_date_id ), array( '%d' ) );
	}

	/**
	 * Unlink a team member from the assets of the given event dates.
	 *
	 * @param int   $member_id      Member ID.
	 * @param int[] $event_date_ids Event dates whose assets lose the link.
	 * @return bool
	 */
	public function remove_member_from_event_dates( $member_id, array $event_date_ids ) {
		global $wpdb;

		$event_date_ids = array_values( array_filter( array_map( 'intval', $event_date_ids ) ) );
		if ( ! $event_date_ids ) {
			return true;
		}

		$placeholders = implode( ', ', array_fill( 0, count( $event_date_ids ), '%d' ) );
		return false !== $wpdb->query(
			$wpdb->prepare( // phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- One array of every value.
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Placeholders only.
				"DELETE m FROM %i AS m INNER JOIN %i AS a ON a.id = m.asset_id WHERE m.member_id = %d AND a.event_date_id IN ( $placeholders )",
				array_merge(
					array( self::members_table(), self::assets_table(), (int) $member_id ),
					$event_date_ids
				)
			)
		);
	}

	/**
	 * Clear a schedule item from every asset that names it.
	 *
	 * @param int $schedule_item_id Schedule item ID.
	 * @return bool
	 */
	public function clear_schedule_item( $schedule_item_id ) {
		global $wpdb;

		return false !== $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET schedule_item_id = NULL, updated_at = %s WHERE schedule_item_id = %d',
				self::assets_table(),
				current_time( 'mysql', true ),
				(int) $schedule_item_id
			)
		);
	}

	/**
	 * Clear a deleted attachment from every asset that uses it, marking
	 * each so the organizer sees the image was removed.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return bool
	 */
	public function clear_attachment( $attachment_id ) {
		global $wpdb;

		return false !== $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET attachment_id = NULL, image_removed = 1, updated_at = %s WHERE attachment_id = %d',
				self::assets_table(),
				current_time( 'mysql', true ),
				(int) $attachment_id
			)
		);
	}

	/**
	 * Attach member IDs to rows and cast their columns.
	 *
	 * @param array[] $rows Raw rows.
	 * @return array[] Hydrated rows.
	 */
	private function with_members( array $rows ) {
		global $wpdb;

		if ( ! $rows ) {
			return array();
		}

		$ids          = array_map( 'intval', wp_list_pluck( $rows, 'id' ) );
		$placeholders = implode( ', ', array_fill( 0, count( $ids ), '%d' ) );
		$links        = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Placeholders only.
				"SELECT asset_id, member_id FROM %i WHERE asset_id IN ( $placeholders ) ORDER BY member_id ASC",
				array_merge( array( self::members_table() ), $ids )
			),
			ARRAY_A
		);

		$by_asset = array();
		foreach ( (array) $links as $link ) {
			$by_asset[ (int) $link['asset_id'] ][] = (int) $link['member_id'];
		}

		$out = array();
		foreach ( $rows as $row ) {
			$id    = (int) $row['id'];
			$out[] = array(
				'id'               => $id,
				'event_date_id'    => (int) $row['event_date_id'],
				'label'            => (string) $row['label'],
				'text'             => (string) $row['text'],
				'attachment_id'    => $row['attachment_id'] ? (int) $row['attachment_id'] : null,
				'image_removed'    => (bool) (int) $row['image_removed'],
				'schedule_item_id' => $row['schedule_item_id'] ? (int) $row['schedule_item_id'] : null,
				'member_ids'       => $by_asset[ $id ] ?? array(),
				'created_at'       => (string) $row['created_at'],
				'updated_at'       => (string) $row['updated_at'],
			);
		}
		return $out;
	}
}
