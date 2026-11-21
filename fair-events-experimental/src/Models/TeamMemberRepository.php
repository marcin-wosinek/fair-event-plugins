<?php
/**
 * Team member directory storage.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Models;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * Reads and writes sitewide team member profiles and their event
 * memberships (#2394).
 *
 * Two site-scoped tables: one row per profile, and one row per membership
 * keyed by the event date that owns it (a single event or a series master)
 * and the member. The unique `(owner_event_date_id, member_id)` key makes a
 * repeated link a no-op. Roles and ordering are left to #2422.
 *
 * Nothing here is gated on the `team-members` bundle: turning it off keeps
 * every profile and membership, and lifecycle cleanup (event deletion,
 * copies) keeps working while it is off.
 */
class TeamMemberRepository {

	/**
	 * Profile table suffix.
	 */
	public const MEMBERS_TABLE = 'fair_events_team_members';

	/**
	 * Membership table suffix.
	 */
	public const MEMBERSHIPS_TABLE = 'fair_events_team_memberships';

	/**
	 * Schema version.
	 */
	public const DB_VERSION = '1';

	/**
	 * Option holding the installed schema version.
	 */
	public const DB_VERSION_OPTION = 'fair_events_experimental_team_members_db_version';

	/**
	 * Accepted grammatical genders. Unset is stored as NULL.
	 */
	public const GENDERS = array( 'male', 'female', 'nonbinary' );

	/**
	 * Profile text columns, in response order.
	 */
	public const TEXT_FIELDS = array( 'name', 'surname', 'instagram', 'email', 'facebook_url', 'phone' );

	/**
	 * Profile table name.
	 *
	 * @return string
	 */
	public static function members_table() {
		global $wpdb;
		return $wpdb->prefix . self::MEMBERS_TABLE;
	}

	/**
	 * Membership table name.
	 *
	 * @return string
	 */
	public static function memberships_table() {
		global $wpdb;
		return $wpdb->prefix . self::MEMBERSHIPS_TABLE;
	}

	/**
	 * Whether the tables have been installed on this site.
	 *
	 * Lifecycle hooks check this so a site that never enabled the bundle runs
	 * no queries against tables that don't exist.
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
	 * Install or upgrade the tables.
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$members     = self::members_table();
		$memberships = self::memberships_table();
		$charset     = $wpdb->get_charset_collate();

		dbDelta(
			"CREATE TABLE {$members} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				name varchar(191) NOT NULL,
				surname varchar(191) NOT NULL DEFAULT '',
				instagram varchar(191) NOT NULL DEFAULT '',
				email varchar(254) NOT NULL DEFAULT '',
				facebook_url varchar(500) NOT NULL DEFAULT '',
				phone varchar(64) NOT NULL DEFAULT '',
				gender varchar(16) DEFAULT NULL,
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				PRIMARY KEY  (id),
				KEY name (name)
			) {$charset};"
		);

		dbDelta(
			"CREATE TABLE {$memberships} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				owner_event_date_id bigint(20) unsigned NOT NULL,
				member_id bigint(20) unsigned NOT NULL,
				created_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY owner_member (owner_event_date_id,member_id),
				KEY member_id (member_id)
			) {$charset};"
		);

		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * All profiles, sorted by name then surname, each with its event count.
	 *
	 * @return array[] Normalized profiles.
	 */
	public function all() {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT m.*, COUNT(ms.id) AS event_count
				FROM %i AS m
				LEFT JOIN %i AS ms ON ms.member_id = m.id
				GROUP BY m.id
				ORDER BY m.name ASC, m.surname ASC, m.id ASC',
				self::members_table(),
				self::memberships_table()
			),
			ARRAY_A
		);

		return array_map( array( self::class, 'normalize' ), (array) $rows );
	}

	/**
	 * One profile with its event count.
	 *
	 * @param int $id Profile ID.
	 * @return array|null Normalized profile, or null when it doesn't exist.
	 */
	public function find( $id ) {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT m.*, (SELECT COUNT(*) FROM %i WHERE member_id = m.id) AS event_count FROM %i AS m WHERE m.id = %d',
				self::memberships_table(),
				self::members_table(),
				(int) $id
			),
			ARRAY_A
		);

		return $row ? self::normalize( $row ) : null;
	}

	/**
	 * Create a profile.
	 *
	 * @param array $data Validated profile fields.
	 * @return array|null The created profile, or null on failure.
	 */
	public function create( array $data ) {
		global $wpdb;

		$now = current_time( 'mysql', true );
		$row = self::to_row( $data );

		$inserted = $wpdb->insert(
			self::members_table(),
			array_merge(
				$row,
				array(
					'created_at' => $now,
					'updated_at' => $now,
				)
			)
		);

		return $inserted ? $this->find( (int) $wpdb->insert_id ) : null;
	}

	/**
	 * Update a profile's given fields; omitted fields keep their value.
	 *
	 * @param int   $id   Profile ID.
	 * @param array $data Validated profile fields to change.
	 * @return array|null The updated profile, or null when it doesn't exist or failed.
	 */
	public function update( $id, array $data ) {
		global $wpdb;

		if ( null === $this->find( $id ) ) {
			return null;
		}

		$row               = self::to_row( $data );
		$row['updated_at'] = current_time( 'mysql', true );

		// `gender` may be NULL; wpdb writes a PHP null as SQL NULL.
		$updated = $wpdb->update( self::members_table(), $row, array( 'id' => (int) $id ) );

		return false === $updated ? null : $this->find( $id );
	}

	/**
	 * Delete a profile unless an event still links to it.
	 *
	 * The profile row is locked first, the same row {@see self::link()}
	 * locks, so a concurrent link either lands before the count (and blocks
	 * the deletion) or finds the profile gone.
	 *
	 * @param int $id Profile ID.
	 * @return true|string True when deleted; 'not_found', 'linked' or 'failed'.
	 */
	public function delete( $id ) {
		global $wpdb;

		$wpdb->query( 'START TRANSACTION' );

		$locked = $wpdb->get_var(
			$wpdb->prepare( 'SELECT id FROM %i WHERE id = %d FOR UPDATE', self::members_table(), (int) $id )
		);
		if ( null === $locked ) {
			$wpdb->query( 'ROLLBACK' );
			return 'not_found';
		}

		$links = (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE member_id = %d', self::memberships_table(), (int) $id )
		);
		if ( $links > 0 ) {
			$wpdb->query( 'ROLLBACK' );
			return 'linked';
		}

		if ( false === $wpdb->delete( self::members_table(), array( 'id' => (int) $id ), array( '%d' ) ) ) {
			$wpdb->query( 'ROLLBACK' );
			return 'failed';
		}

		$wpdb->query( 'COMMIT' );
		return true;
	}

	/**
	 * Owner event date IDs a profile is linked to.
	 *
	 * @param int $member_id Profile ID.
	 * @return int[]
	 */
	public function owner_ids_for_member( $member_id ) {
		global $wpdb;

		$ids = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT owner_event_date_id FROM %i WHERE member_id = %d ORDER BY owner_event_date_id ASC',
				self::memberships_table(),
				(int) $member_id
			)
		);

		return array_map( 'intval', (array) $ids );
	}

	/**
	 * Members of an owning event date: IDs, names and surnames only.
	 *
	 * @param int $owner_id Owning event date ID.
	 * @return array[] `{ id, name, surname }` per member, by name.
	 */
	public function members_of( $owner_id ) {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT m.id, m.name, m.surname
				FROM %i AS ms
				INNER JOIN %i AS m ON m.id = ms.member_id
				WHERE ms.owner_event_date_id = %d
				ORDER BY m.name ASC, m.surname ASC, m.id ASC',
				self::memberships_table(),
				self::members_table(),
				(int) $owner_id
			),
			ARRAY_A
		);

		return array_map( array( self::class, 'public_fields' ), (array) $rows );
	}

	/**
	 * Names and surnames for the given profile IDs, for an authorized
	 * marketing consumer (#2396). Unknown IDs are left out. Nothing else of
	 * the profile is returned.
	 *
	 * @param int[] $ids Profile IDs.
	 * @return array[] `{ id, name, surname }` per existing profile, keyed by ID.
	 */
	public function names_for( array $ids ) {
		global $wpdb;

		$ids = array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
		if ( ! $ids || ! self::is_installed() ) {
			return array();
		}

		$placeholders = implode( ', ', array_fill( 0, count( $ids ), '%d' ) );
		$rows         = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, name, surname FROM %i WHERE id IN ( $placeholders )", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Placeholders only.
				array_merge( array( self::members_table() ), $ids )
			),
			ARRAY_A
		);

		$out = array();
		foreach ( (array) $rows as $row ) {
			$out[ (int) $row['id'] ] = self::public_fields( $row );
		}
		return $out;
	}

	/**
	 * Link a member to an owning event date. A repeated link is a no-op.
	 *
	 * Locks the profile row, like {@see self::delete()}, so a profile
	 * deleted meanwhile is never linked.
	 *
	 * @param int $owner_id  Owning event date ID.
	 * @param int $member_id Profile ID.
	 * @return string 'created', 'exists', 'not_found' or 'failed'.
	 */
	public function link( $owner_id, $member_id ) {
		global $wpdb;

		$wpdb->query( 'START TRANSACTION' );

		$locked = $wpdb->get_var(
			$wpdb->prepare( 'SELECT id FROM %i WHERE id = %d FOR UPDATE', self::members_table(), (int) $member_id )
		);
		if ( null === $locked ) {
			$wpdb->query( 'ROLLBACK' );
			return 'not_found';
		}

		$result = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (owner_event_date_id, member_id, created_at) VALUES (%d, %d, %s)',
				self::memberships_table(),
				(int) $owner_id,
				(int) $member_id,
				current_time( 'mysql', true )
			)
		);
		if ( false === $result ) {
			$wpdb->query( 'ROLLBACK' );
			return 'failed';
		}

		$wpdb->query( 'COMMIT' );
		return $result > 0 ? 'created' : 'exists';
	}

	/**
	 * Remove one membership. Removing a missing one is a no-op.
	 *
	 * @param int $owner_id  Owning event date ID.
	 * @param int $member_id Profile ID.
	 * @return bool False only on a database error.
	 */
	public function unlink( $owner_id, $member_id ) {
		global $wpdb;

		return false !== $wpdb->delete(
			self::memberships_table(),
			array(
				'owner_event_date_id' => (int) $owner_id,
				'member_id'           => (int) $member_id,
			),
			array( '%d', '%d' )
		);
	}

	/**
	 * Remove every membership an event date owns.
	 *
	 * @param int $owner_id Owning event date ID.
	 * @return bool False only on a database error.
	 */
	public function delete_owner( $owner_id ) {
		global $wpdb;

		return false !== $wpdb->delete(
			self::memberships_table(),
			array( 'owner_event_date_id' => (int) $owner_id ),
			array( '%d' )
		);
	}

	/**
	 * Copy every membership of one owner to another. Existing memberships
	 * of the destination are kept.
	 *
	 * @param int $source_owner_id      Source owning event date ID.
	 * @param int $destination_owner_id Destination owning event date ID.
	 * @return bool False only on a database error.
	 */
	public function copy_owner( $source_owner_id, $destination_owner_id ) {
		global $wpdb;

		return false !== $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (owner_event_date_id, member_id, created_at)
				SELECT %d, member_id, %s FROM %i WHERE owner_event_date_id = %d',
				self::memberships_table(),
				(int) $destination_owner_id,
				current_time( 'mysql', true ),
				self::memberships_table(),
				(int) $source_owner_id
			)
		);
	}

	/**
	 * Map validated fields to their columns.
	 *
	 * @param array $data Validated fields.
	 * @return array Column values.
	 */
	private static function to_row( array $data ) {
		$row = array();
		foreach ( self::TEXT_FIELDS as $field ) {
			if ( array_key_exists( $field, $data ) ) {
				$row[ $field ] = (string) $data[ $field ];
			}
		}
		if ( array_key_exists( 'gender', $data ) ) {
			$row['gender'] = in_array( $data['gender'], self::GENDERS, true ) ? $data['gender'] : null;
		}
		return $row;
	}

	/**
	 * The fields of a profile that may appear outside the directory.
	 *
	 * @param array $row Database row.
	 * @return array `{ id, name, surname }`.
	 */
	private static function public_fields( array $row ) {
		return array(
			'id'      => (int) $row['id'],
			'name'    => (string) $row['name'],
			'surname' => (string) $row['surname'],
		);
	}

	/**
	 * Normalize a profile row for administrators.
	 *
	 * @param array $row Database row.
	 * @return array Profile.
	 */
	private static function normalize( array $row ) {
		$profile = array( 'id' => (int) $row['id'] );
		foreach ( self::TEXT_FIELDS as $field ) {
			$profile[ $field ] = (string) $row[ $field ];
		}
		$profile['gender']      = in_array( $row['gender'], self::GENDERS, true ) ? $row['gender'] : null;
		$profile['event_count'] = isset( $row['event_count'] ) ? (int) $row['event_count'] : 0;
		return $profile;
	}
}
