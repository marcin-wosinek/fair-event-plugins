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
 * Reads and writes sitewide team member profiles and their ordered
 * assignments to events and programme items (#2394, #2422).
 *
 * Two site-scoped tables: one row per profile, and one row per assignment.
 * An assignment's target is the event date that owns it (a single event or
 * a series master) and, for a programme contributor, the owner's schedule
 * item (`schedule_item_id`, 0 for the event itself). It carries a role and
 * a position within its target. The unique
 * `(owner_event_date_id, schedule_item_id, member_id, role)` key lets one
 * person hold several roles on a target but never the same role twice. A
 * membership from #2394 has the empty role: it stays one membership, is
 * still unique per event and member, and never blocks a role-bearing
 * assignment of the same person.
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
	 * Schema version. 3 adds roles, ordering and programme items (#2422).
	 */
	public const DB_VERSION = '3';

	/**
	 * Role of a #2394 membership, which has none.
	 */
	public const NO_ROLE = '';

	/**
	 * Schedule item of an event-level assignment.
	 */
	public const EVENT_TARGET = 0;

	/**
	 * Accepted role slugs, as in Event Content Studio campaign facts v1.
	 */
	public const ROLE_PATTERN = '/^[a-z][a-z0-9_-]*$/';

	/**
	 * Longest accepted role slug.
	 */
	public const ROLE_MAX_LENGTH = 64;

	/**
	 * Most assignments one target accepts.
	 */
	public const MAX_ASSIGNMENTS = 100;

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
	public const TEXT_FIELDS = array( 'name', 'surname', 'instagram', 'email', 'facebook_url', 'phone', 'website_url', 'bio' );

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
	 * Upgrade tables that are already installed, whether or not the bundle
	 * is on, so lifecycle cleanup and copies always run against the current
	 * schema. A site that never enabled the bundle gets no tables.
	 *
	 * @return void
	 */
	public static function maybe_upgrade() {
		if ( self::is_installed() ) {
			self::maybe_install();
		}
	}

	/**
	 * Whether a value is an accepted role slug.
	 *
	 * @param mixed $role Submitted role.
	 * @return bool
	 */
	public static function is_valid_role( $role ) {
		return is_string( $role )
			&& strlen( $role ) <= self::ROLE_MAX_LENGTH
			&& 1 === preg_match( self::ROLE_PATTERN, $role );
	}

	/**
	 * Install or upgrade the tables.
	 *
	 * Version 2 (#2421) adds `website_url`, `bio` and
	 * `portrait_attachment_id`; dbDelta adds them to an existing table and
	 * leaves every row, ID and membership as it was. `bio` is nullable
	 * because a TEXT column cannot have a default; a NULL reads as blank.
	 * Upgrading from version 1 or 2 keeps every membership and its ID, gives
	 * each one the empty role, and numbers them per event in the order the
	 * event showed them (by name and surname). The installed version is only
	 * recorded once the new schema is in place, so a failed upgrade is
	 * retried on the next request.
	 *
	 * @return void
	 */
	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$members     = self::members_table();
		$memberships = self::memberships_table();
		$charset     = $wpdb->get_charset_collate();
		$previous    = (string) get_option( self::DB_VERSION_OPTION, '' );

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
				website_url varchar(500) NOT NULL DEFAULT '',
				bio text DEFAULT NULL,
				portrait_attachment_id bigint(20) unsigned NOT NULL DEFAULT 0,
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
				schedule_item_id bigint(20) unsigned NOT NULL DEFAULT 0,
				member_id bigint(20) unsigned NOT NULL,
				role varchar(64) NOT NULL DEFAULT '',
				position int(10) unsigned NOT NULL DEFAULT 0,
				created_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY target_member_role (owner_event_date_id,schedule_item_id,member_id,role),
				KEY member_id (member_id),
				KEY schedule_item_id (schedule_item_id)
			) {$charset};"
		);

		// dbDelta never drops an index: the version 1 key would keep one
		// row per event and member, refusing a second role.
		if ( self::has_index( $memberships, 'owner_member' ) ) {
			$wpdb->query( $wpdb->prepare( 'ALTER TABLE %i DROP INDEX owner_member', $memberships ) );
		}

		if ( ! self::has_index( $memberships, 'target_member_role' ) || self::has_index( $memberships, 'owner_member' ) ) {
			return;
		}

		if ( in_array( $previous, array( '1', '2' ), true ) && ! self::backfill_positions() ) {
			return;
		}

		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Whether a table has an index.
	 *
	 * @param string $table Table name.
	 * @param string $index Index name.
	 * @return bool
	 */
	private static function has_index( $table, $index ) {
		global $wpdb;

		return (bool) $wpdb->get_var(
			$wpdb->prepare( 'SHOW INDEX FROM %i WHERE Key_name = %s', $table, $index )
		);
	}

	/**
	 * Number legacy memberships per event in their displayed order.
	 *
	 * @return bool False on a database error.
	 */
	private static function backfill_positions() {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT ms.id, ms.owner_event_date_id
				FROM %i AS ms
				LEFT JOIN %i AS m ON m.id = ms.member_id
				WHERE ms.schedule_item_id = 0
				ORDER BY ms.owner_event_date_id ASC, m.name ASC, m.surname ASC, ms.member_id ASC, ms.id ASC',
				self::memberships_table(),
				self::members_table()
			),
			ARRAY_A
		);
		if ( '' !== $wpdb->last_error ) {
			return false;
		}

		$owner    = null;
		$position = 0;
		foreach ( (array) $rows as $row ) {
			if ( $owner !== (int) $row['owner_event_date_id'] ) {
				$owner    = (int) $row['owner_event_date_id'];
				$position = 0;
			}
			$updated = $wpdb->update(
				self::memberships_table(),
				array( 'position' => $position ),
				array( 'id' => (int) $row['id'] ),
				array( '%d' ),
				array( '%d' )
			);
			if ( false === $updated ) {
				return false;
			}
			++$position;
		}

		return true;
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
				'SELECT m.*, COUNT(DISTINCT ms.owner_event_date_id) AS event_count
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
				'SELECT m.*, (SELECT COUNT(DISTINCT owner_event_date_id) FROM %i WHERE member_id = m.id) AS event_count FROM %i AS m WHERE m.id = %d',
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
	 * Delete a profile unless an event or programme item still refers to it.
	 *
	 * The profile row is locked first, the same row {@see self::link()} and
	 * {@see self::add_assignment()} lock, so a concurrent assignment either
	 * lands before the count (and blocks the deletion) or finds the profile
	 * gone.
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

		$links = $wpdb->get_var(
			$wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE member_id = %d', self::memberships_table(), (int) $id )
		);
		if ( null === $links ) {
			$wpdb->query( 'ROLLBACK' );
			return 'failed';
		}
		if ( (int) $links > 0 ) {
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
	 * Owner event date IDs a profile is assigned to, on the event itself or
	 * on one of its programme items.
	 *
	 * @param int $member_id Profile ID.
	 * @return int[]
	 */
	public function owner_ids_for_member( $member_id ) {
		global $wpdb;

		$ids = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT DISTINCT owner_event_date_id FROM %i WHERE member_id = %d ORDER BY owner_event_date_id ASC',
				self::memberships_table(),
				(int) $member_id
			)
		);

		return array_map( 'intval', (array) $ids );
	}

	/**
	 * Programme items a profile is assigned to, per owning event date.
	 *
	 * @param int $member_id Profile ID.
	 * @return array<int, int[]> Schedule item IDs keyed by owner event date ID.
	 */
	public function programme_items_for_member( $member_id ) {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT DISTINCT owner_event_date_id, schedule_item_id FROM %i
				WHERE member_id = %d AND schedule_item_id > 0
				ORDER BY owner_event_date_id ASC, schedule_item_id ASC',
				self::memberships_table(),
				(int) $member_id
			),
			ARRAY_A
		);

		$items = array();
		foreach ( (array) $rows as $row ) {
			$items[ (int) $row['owner_event_date_id'] ][] = (int) $row['schedule_item_id'];
		}
		return $items;
	}

	/**
	 * Members of an owning event date, once each in the order of their
	 * first assignment: IDs, names and surnames only.
	 *
	 * @param int $owner_id Owning event date ID.
	 * @return array[] `{ id, name, surname }` per member.
	 */
	public function members_of( $owner_id ) {
		$members = array();
		foreach ( (array) $this->assignments_of( $owner_id ) as $assignment ) {
			if ( null !== $assignment['name'] && ! isset( $members[ $assignment['member_id'] ] ) ) {
				$members[ $assignment['member_id'] ] = array(
					'id'      => $assignment['member_id'],
					'name'    => $assignment['name'],
					'surname' => $assignment['surname'],
				);
			}
		}
		return array_values( $members );
	}

	/**
	 * The ordered assignments of one target: the event itself, or one of
	 * its programme items.
	 *
	 * @param int $owner_id Owning event date ID.
	 * @param int $item_id  Schedule item ID, or 0 for the event itself.
	 * @return array[]|null `{ id, member_id, name, surname, role }` per
	 *                      assignment (role null for a #2394 membership),
	 *                      by position; null on a database error.
	 *                      `name` is null when the profile is missing.
	 */
	public function assignments_of( $owner_id, $item_id = self::EVENT_TARGET ) {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT ms.id, ms.member_id, ms.role, ms.schedule_item_id, m.name, m.surname
				FROM %i AS ms
				LEFT JOIN %i AS m ON m.id = ms.member_id
				WHERE ms.owner_event_date_id = %d AND ms.schedule_item_id = %d
				ORDER BY ms.position ASC, ms.id ASC',
				self::memberships_table(),
				self::members_table(),
				(int) $owner_id,
				(int) $item_id
			),
			ARRAY_A
		);
		if ( '' !== $wpdb->last_error ) {
			return null;
		}

		return array_map( array( self::class, 'assignment' ), (array) $rows );
	}

	/**
	 * The ordered assignments of every programme item of an owner.
	 *
	 * @param int $owner_id Owning event date ID.
	 * @return array<int, array[]>|null Assignments (see assignments_of())
	 *                                  keyed by schedule item ID; null on a
	 *                                  database error.
	 */
	public function programme_assignments_of( $owner_id ) {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT ms.id, ms.member_id, ms.role, ms.schedule_item_id, m.name, m.surname
				FROM %i AS ms
				LEFT JOIN %i AS m ON m.id = ms.member_id
				WHERE ms.owner_event_date_id = %d AND ms.schedule_item_id > 0
				ORDER BY ms.schedule_item_id ASC, ms.position ASC, ms.id ASC',
				self::memberships_table(),
				self::members_table(),
				(int) $owner_id
			),
			ARRAY_A
		);
		if ( '' !== $wpdb->last_error ) {
			return null;
		}

		$items = array();
		foreach ( (array) $rows as $row ) {
			$items[ (int) $row['schedule_item_id'] ][] = self::assignment( $row );
		}
		return $items;
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
	 * The promotional columns of the given profiles, for
	 * {@see \FairEventsExperimental\Services\PromotionalTeamProfiles}.
	 * Contact details and the grammatical gender are never selected.
	 *
	 * Unlike {@see self::names_for()}, a failed query is an error rather
	 * than an empty result.
	 *
	 * @param int[] $ids Positive profile IDs.
	 * @return array[]|\WP_Error Rows keyed by ID, or `fair_events_source_unavailable`.
	 */
	public function promotional_rows_checked( array $ids ) {
		global $wpdb;

		$ids = array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
		if ( ! $ids ) {
			return array();
		}

		$placeholders = implode( ', ', array_fill( 0, count( $ids ), '%d' ) );
		$rows         = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, name, surname, instagram, website_url, bio, portrait_attachment_id FROM %i WHERE id IN ( $placeholders )", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Placeholders only.
				array_merge( array( self::members_table() ), $ids )
			),
			ARRAY_A
		);

		if ( ! empty( $wpdb->last_error ) || ! is_array( $rows ) ) {
			return new \WP_Error(
				'fair_events_source_unavailable',
				__( 'Team member profiles could not be read.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		$out = array();
		foreach ( $rows as $row ) {
			$out[ (int) $row['id'] ] = $row;
		}
		return $out;
	}

	/**
	 * Link a member to an owning event date without a role, as #2394 did.
	 * A repeated link is a no-op.
	 *
	 * @param int $owner_id  Owning event date ID.
	 * @param int $member_id Profile ID.
	 * @return string 'created', 'exists', 'not_found', 'full' or 'failed'.
	 */
	public function link( $owner_id, $member_id ) {
		return $this->add_assignment( $owner_id, self::EVENT_TARGET, $member_id, self::NO_ROLE )['result'];
	}

	/**
	 * Append an assignment to a target. A repeated member and role is
	 * refused and changes nothing.
	 *
	 * Locks the profile row, like {@see self::delete()}, so a profile
	 * deleted meanwhile is never assigned.
	 *
	 * @param int    $owner_id  Owning event date ID.
	 * @param int    $item_id   Schedule item ID, or 0 for the event itself.
	 * @param int    $member_id Profile ID.
	 * @param string $role      Validated role slug, or '' for a #2394 membership.
	 * @return array{result: string, id: int} `result` is 'created', 'exists',
	 *                                        'not_found', 'full' or 'failed';
	 *                                        `id` the new assignment's ID.
	 */
	public function add_assignment( $owner_id, $item_id, $member_id, $role ) {
		global $wpdb;

		$outcome = static function ( $result, $id = 0 ) {
			return array(
				'result' => $result,
				'id'     => (int) $id,
			);
		};

		$wpdb->query( 'START TRANSACTION' );

		$locked = $wpdb->get_var(
			$wpdb->prepare( 'SELECT id FROM %i WHERE id = %d FOR UPDATE', self::members_table(), (int) $member_id )
		);
		if ( null === $locked ) {
			$wpdb->query( 'ROLLBACK' );
			return $outcome( '' !== $wpdb->last_error ? 'failed' : 'not_found' );
		}

		// Lock the target's rows so two additions get distinct positions.
		$target = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, position FROM %i WHERE owner_event_date_id = %d AND schedule_item_id = %d FOR UPDATE',
				self::memberships_table(),
				(int) $owner_id,
				(int) $item_id
			),
			ARRAY_A
		);
		if ( '' !== $wpdb->last_error ) {
			$wpdb->query( 'ROLLBACK' );
			return $outcome( 'failed' );
		}
		if ( count( (array) $target ) >= self::MAX_ASSIGNMENTS ) {
			$wpdb->query( 'ROLLBACK' );
			return $outcome( 'full' );
		}

		$next = 0;
		foreach ( (array) $target as $row ) {
			$next = max( $next, (int) $row['position'] + 1 );
		}

		$result = $wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO %i (owner_event_date_id, schedule_item_id, member_id, role, position, created_at) VALUES (%d, %d, %d, %s, %d, %s)',
				self::memberships_table(),
				(int) $owner_id,
				(int) $item_id,
				(int) $member_id,
				(string) $role,
				$next,
				current_time( 'mysql', true )
			)
		);
		if ( false === $result ) {
			$wpdb->query( 'ROLLBACK' );
			return $outcome( 'failed' );
		}

		$id = (int) $wpdb->insert_id;
		$wpdb->query( 'COMMIT' );
		return $result > 0 ? $outcome( 'created', $id ) : $outcome( 'exists' );
	}

	/**
	 * Remove one membership without a role. The member's role-bearing
	 * assignments are kept. Removing a missing one is a no-op.
	 *
	 * @param int $owner_id  Owning event date ID.
	 * @param int $member_id Profile ID.
	 * @return bool False only on a database error.
	 */
	public function unlink( $owner_id, $member_id ) {
		return $this->remove_event_membership( $owner_id, 0, $member_id );
	}

	/**
	 * Remove one assignment of a target by its ID. The person's other roles
	 * and targets are kept. Removing a missing one is a no-op.
	 *
	 * @param int $owner_id      Owning event date ID.
	 * @param int $item_id       Schedule item ID, or 0 for the event itself.
	 * @param int $assignment_id Assignment ID.
	 * @return bool False only on a database error.
	 */
	public function remove_assignment( $owner_id, $item_id, $assignment_id ) {
		if ( self::EVENT_TARGET === (int) $item_id ) {
			return $this->remove_event_membership( $owner_id, $assignment_id );
		}

		global $wpdb;

		return false !== $wpdb->delete(
			self::memberships_table(),
			array(
				'id'                  => (int) $assignment_id,
				'owner_event_date_id' => (int) $owner_id,
				'schedule_item_id'    => (int) $item_id,
			),
			array( '%d', '%d', '%d' )
		);
	}

	/**
	 * Remove an event assignment by ID or the member's legacy roleless entry.
	 *
	 * @param int $owner_id Owning event date ID.
	 * @param int $assignment_id Assignment ID, or zero for a legacy unlink.
	 * @param int $legacy_member_id Member ID for a legacy unlink.
	 * @return bool False on a database error.
	 */
	private function remove_event_membership( $owner_id, $assignment_id, $legacy_member_id = 0 ) {
		global $wpdb;

		$wpdb->query( 'START TRANSACTION' );
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, member_id, role FROM %i WHERE owner_event_date_id = %d AND schedule_item_id = %d FOR UPDATE',
				self::memberships_table(),
				(int) $owner_id,
				self::EVENT_TARGET
			),
			ARRAY_A
		);
		if ( ! is_array( $rows ) || '' !== $wpdb->last_error ) {
			$wpdb->query( 'ROLLBACK' );
			return false;
		}

		foreach ( $rows as $row ) {
			$matches = $legacy_member_id
				? (int) $legacy_member_id === (int) $row['member_id'] && self::NO_ROLE === $row['role']
				: (int) $assignment_id === (int) $row['id'];
			if ( ! $matches ) {
				continue;
			}

			$deleted = $wpdb->delete( self::memberships_table(), array( 'id' => (int) $row['id'] ), array( '%d' ) );
			if ( false === $deleted ) {
				$wpdb->query( 'ROLLBACK' );
				return false;
			}

			$membership_counts = array_count_values( array_column( $rows, 'member_id' ) );
			if ( $deleted > 0 && 1 === $membership_counts[ $row['member_id'] ] ) {
				/**
				 * Fires after a member loses their last assignment on an event's team.
				 *
				 * Marketing assets clear links to the member on dates sharing the team.
				 *
				 * @param int $owner_id Team owner event date ID.
				 * @param int $member_id Removed member ID.
				 */
				do_action( 'fair_events_experimental_team_member_unlinked', (int) $owner_id, (int) $row['member_id'] );
			}
			break;
		}

		return false !== $wpdb->query( 'COMMIT' );
	}

	/**
	 * Put a target's assignments in the given order.
	 *
	 * The order must name exactly the target's current assignments, read
	 * under a row lock; anything else means the screen is out of date, and
	 * nothing changes.
	 *
	 * @param int   $owner_id       Owning event date ID.
	 * @param int   $item_id        Schedule item ID, or 0 for the event itself.
	 * @param int[] $assignment_ids Every assignment ID of the target, in the new order.
	 * @return string 'reordered', 'stale' or 'failed'.
	 */
	public function reorder( $owner_id, $item_id, array $assignment_ids ) {
		global $wpdb;

		$wpdb->query( 'START TRANSACTION' );

		$current = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT id FROM %i WHERE owner_event_date_id = %d AND schedule_item_id = %d FOR UPDATE',
				self::memberships_table(),
				(int) $owner_id,
				(int) $item_id
			)
		);
		if ( '' !== $wpdb->last_error ) {
			$wpdb->query( 'ROLLBACK' );
			return 'failed';
		}

		$requested = array_map( 'intval', $assignment_ids );
		$current   = array_map( 'intval', (array) $current );
		$sorted    = $requested;
		sort( $sorted );
		sort( $current );
		if ( $sorted !== $current || count( array_unique( $requested ) ) !== count( $requested ) ) {
			$wpdb->query( 'ROLLBACK' );
			return 'stale';
		}

		foreach ( $requested as $position => $id ) {
			$updated = $wpdb->update(
				self::memberships_table(),
				array( 'position' => $position ),
				array( 'id' => $id ),
				array( '%d' ),
				array( '%d' )
			);
			if ( false === $updated ) {
				$wpdb->query( 'ROLLBACK' );
				return 'failed';
			}
		}

		$wpdb->query( 'COMMIT' );
		return 'reordered';
	}

	/**
	 * Remove every assignment of a programme item.
	 *
	 * @param int $item_id Schedule item ID.
	 * @return bool False only on a database error.
	 */
	public function delete_item( $item_id ) {
		global $wpdb;

		if ( (int) $item_id <= 0 ) {
			return true;
		}

		return false !== $wpdb->delete(
			self::memberships_table(),
			array( 'schedule_item_id' => (int) $item_id ),
			array( '%d' )
		);
	}

	/**
	 * Remove every assignment an event date owns, programme items included.
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
	 * Copy the assignments of one owner to another, in their order: the
	 * event's own, and each programme item's onto the copied item. Items
	 * missing from the map are not copied. Existing assignments of the
	 * destination are kept.
	 *
	 * @param int             $source_owner_id      Source owning event date ID.
	 * @param int             $destination_owner_id Destination owning event date ID.
	 * @param array<int, int> $item_map             Source-to-destination schedule item IDs.
	 * @return bool False only on a database error.
	 */
	public function copy_owner( $source_owner_id, $destination_owner_id, array $item_map = array() ) {
		global $wpdb;

		$targets = array( self::EVENT_TARGET => self::EVENT_TARGET );
		foreach ( $item_map as $source_item => $destination_item ) {
			if ( (int) $source_item > 0 && (int) $destination_item > 0 ) {
				$targets[ (int) $source_item ] = (int) $destination_item;
			}
		}

		foreach ( $targets as $source_item => $destination_item ) {
			$copied = $wpdb->query(
				$wpdb->prepare(
					'INSERT IGNORE INTO %i (owner_event_date_id, schedule_item_id, member_id, role, position, created_at)
					SELECT %d, %d, member_id, role, position, %s FROM %i
					WHERE owner_event_date_id = %d AND schedule_item_id = %d
					ORDER BY position ASC, id ASC',
					self::memberships_table(),
					(int) $destination_owner_id,
					(int) $destination_item,
					current_time( 'mysql', true ),
					self::memberships_table(),
					(int) $source_owner_id,
					(int) $source_item
				)
			);
			if ( false === $copied ) {
				return false;
			}
		}

		return true;
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
		if ( array_key_exists( 'portrait_attachment_id', $data ) ) {
			$row['portrait_attachment_id'] = max( 0, (int) $data['portrait_attachment_id'] );
		}
		return $row;
	}

	/**
	 * Normalize an assignment row.
	 *
	 * @param array $row Database row joined with its profile.
	 * @return array `{ id, member_id, name, surname, role }`.
	 */
	private static function assignment( array $row ) {
		return array(
			'id'        => (int) $row['id'],
			'member_id' => (int) $row['member_id'],
			'name'      => null === $row['name'] ? null : (string) $row['name'],
			'surname'   => null === $row['surname'] ? null : (string) $row['surname'],
			'role'      => self::NO_ROLE === (string) $row['role'] ? null : (string) $row['role'],
		);
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
			$profile[ $field ] = isset( $row[ $field ] ) ? (string) $row[ $field ] : '';
		}
		$portrait                          = isset( $row['portrait_attachment_id'] ) ? (int) $row['portrait_attachment_id'] : 0;
		$profile['gender']                 = in_array( $row['gender'], self::GENDERS, true ) ? $row['gender'] : null;
		$profile['portrait_attachment_id'] = $portrait > 0 ? $portrait : null;
		$profile['event_count']            = isset( $row['event_count'] ) ? (int) $row['event_count'] : 0;
		return $profile;
	}
}
