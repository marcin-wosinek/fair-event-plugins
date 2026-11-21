<?php
/**
 * Storage for event and programme-item image associations.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\EventImages;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * One row per image linked to an event or to one of its programme items.
 *
 * A list is identified by its owner event date (the series master for a
 * series) and a schedule item ID, 0 for the event's own images. Rows carry
 * their position in the list and an optional circle (all three geometry
 * columns set, or all NULL). `source_revision` fingerprints the attachment
 * file the circle was drawn on, so an image edited in place afterwards no
 * longer exposes a circle that may point at the wrong subject.
 *
 * The table is installed while the `event-images` bundle is on and kept
 * when it is turned off.
 */
class Store {

	public const DB_VERSION        = '1';
	public const DB_VERSION_OPTION = 'fair_events_experimental_event_images_db_version';
	public const TABLE_SUFFIX      = 'fair_events_experimental_event_images';

	/**
	 * Table name with prefix.
	 *
	 * @return string
	 */
	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . self::TABLE_SUFFIX;
	}

	/**
	 * Whether the table was ever installed on this site.
	 *
	 * @return bool
	 */
	public static function is_installed() {
		return '' !== (string) get_option( self::DB_VERSION_OPTION, '' );
	}

	/**
	 * Install or upgrade the table when the stored version differs.
	 *
	 * @return void
	 */
	public static function maybe_install() {
		if ( self::DB_VERSION !== (string) get_option( self::DB_VERSION_OPTION, '' ) ) {
			self::install();
		}
	}

	/**
	 * Install or upgrade the table.
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = self::table_name();
		$charset = $wpdb->get_charset_collate();
		dbDelta(
			"CREATE TABLE {$table} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				event_date_id bigint(20) unsigned NOT NULL,
				schedule_item_id bigint(20) unsigned NOT NULL DEFAULT 0,
				attachment_id bigint(20) unsigned NOT NULL,
				position int(10) unsigned NOT NULL DEFAULT 0,
				center_x double DEFAULT NULL,
				center_y double DEFAULT NULL,
				radius double DEFAULT NULL,
				source_revision varchar(64) NOT NULL DEFAULT '',
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY list_attachment (event_date_id,schedule_item_id,attachment_id),
				KEY attachment (attachment_id)
			) {$charset};"
		);
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Every row of an owner event date, in list order.
	 *
	 * @param int $event_date_id Owner event date ID.
	 * @return array<int, object> Rows with integer and float fields cast.
	 */
	public static function rows_for_owner( $event_date_id ) {
		global $wpdb;
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY schedule_item_id ASC, position ASC, id ASC',
				self::table_name(),
				(int) $event_date_id
			)
		);
		return array_map( array( self::class, 'hydrate' ), $rows ? $rows : array() );
	}

	/**
	 * The rows of one list, in list order.
	 *
	 * @param int  $event_date_id    Owner event date ID.
	 * @param int  $schedule_item_id Schedule item ID, 0 for the event.
	 * @param bool $for_update       Lock the rows (inside a transaction).
	 * @return array<int, object>
	 */
	public static function rows_for_list( $event_date_id, $schedule_item_id, $for_update = false ) {
		global $wpdb;
		if ( $for_update ) {
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE event_date_id = %d AND schedule_item_id = %d ORDER BY position ASC, id ASC FOR UPDATE',
					self::table_name(),
					(int) $event_date_id,
					(int) $schedule_item_id
				)
			);
		} else {
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE event_date_id = %d AND schedule_item_id = %d ORDER BY position ASC, id ASC',
					self::table_name(),
					(int) $event_date_id,
					(int) $schedule_item_id
				)
			);
		}
		return array_map( array( self::class, 'hydrate' ), $rows ? $rows : array() );
	}

	/**
	 * Insert a row.
	 *
	 * @param array $data Columns.
	 * @return int New row ID, 0 on failure.
	 */
	public static function insert( array $data ) {
		global $wpdb;
		$now = current_time( 'mysql', true );
		$ok  = $wpdb->insert(
			self::table_name(),
			array(
				'event_date_id'    => (int) $data['event_date_id'],
				'schedule_item_id' => (int) $data['schedule_item_id'],
				'attachment_id'    => (int) $data['attachment_id'],
				'position'         => (int) $data['position'],
				'center_x'         => $data['center_x'],
				'center_y'         => $data['center_y'],
				'radius'           => $data['radius'],
				'source_revision'  => (string) $data['source_revision'],
				'created_at'       => $now,
				'updated_at'       => $now,
			),
			array( '%d', '%d', '%d', '%d', '%f', '%f', '%f', '%s', '%s', '%s' )
		);
		return $ok ? (int) $wpdb->insert_id : 0;
	}

	/**
	 * Update a row's position and geometry.
	 *
	 * @param int   $id   Row ID.
	 * @param array $data `position`, `center_x`, `center_y`, `radius`, `source_revision`.
	 * @return bool
	 */
	public static function update( $id, array $data ) {
		global $wpdb;
		$ok = $wpdb->update(
			self::table_name(),
			array(
				'position'        => (int) $data['position'],
				'center_x'        => $data['center_x'],
				'center_y'        => $data['center_y'],
				'radius'          => $data['radius'],
				'source_revision' => (string) $data['source_revision'],
				'updated_at'      => current_time( 'mysql', true ),
			),
			array( 'id' => (int) $id ),
			array( '%d', '%f', '%f', '%f', '%s', '%s' ),
			array( '%d' )
		);
		return false !== $ok;
	}

	/**
	 * Delete rows by ID.
	 *
	 * @param int[] $ids Row IDs.
	 * @return bool
	 */
	public static function delete_ids( array $ids ) {
		global $wpdb;
		$ids = array_values( array_filter( array_map( 'intval', $ids ) ) );
		if ( ! $ids ) {
			return true;
		}
		$placeholders = implode( ', ', array_fill( 0, count( $ids ), '%d' ) );
		return false !== $wpdb->query(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				"DELETE FROM %i WHERE id IN ( {$placeholders} )",
				array_merge( array( self::table_name() ), $ids )
			)
		);
	}

	/**
	 * Delete every row of an owner event date.
	 *
	 * @param int $event_date_id Owner event date ID.
	 * @return void
	 */
	public static function delete_for_owner( $event_date_id ) {
		global $wpdb;
		$wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE event_date_id = %d',
				self::table_name(),
				(int) $event_date_id
			)
		);
	}

	/**
	 * Remove an attachment from every list, closing the gaps it leaves so
	 * the remaining images keep their order.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return void
	 */
	public static function delete_attachment( $attachment_id ) {
		global $wpdb;
		$table = self::table_name();
		$rows  = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT event_date_id, schedule_item_id FROM %i WHERE attachment_id = %d',
				$table,
				(int) $attachment_id
			)
		);
		if ( ! $rows ) {
			return;
		}

		$wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE attachment_id = %d',
				$table,
				(int) $attachment_id
			)
		);

		foreach ( $rows as $row ) {
			$position = 0;
			foreach ( self::rows_for_list( (int) $row->event_date_id, (int) $row->schedule_item_id ) as $remaining ) {
				if ( $remaining->position !== $position ) {
					$wpdb->update(
						$table,
						array( 'position' => $position ),
						array( 'id' => $remaining->id ),
						array( '%d' ),
						array( '%d' )
					);
				}
				++$position;
			}
		}
	}

	/**
	 * Cast a database row.
	 *
	 * @param object $row Raw row.
	 * @return object
	 */
	private static function hydrate( $row ) {
		$has_circle = null !== $row->center_x && null !== $row->center_y && null !== $row->radius;
		return (object) array(
			'id'               => (int) $row->id,
			'event_date_id'    => (int) $row->event_date_id,
			'schedule_item_id' => (int) $row->schedule_item_id,
			'attachment_id'    => (int) $row->attachment_id,
			'position'         => (int) $row->position,
			'center_x'         => $has_circle ? (float) $row->center_x : null,
			'center_y'         => $has_circle ? (float) $row->center_y : null,
			'radius'           => $has_circle ? (float) $row->radius : null,
			'source_revision'  => (string) $row->source_revision,
		);
	}
}
