<?php
/**
 * Group Permission Rule model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Group Permission Rule model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class GroupPermissionRule {

	/**
	 * Rule ID
	 *
	 * @var int
	 */
	public $id;

	/**
	 * Event date ID
	 *
	 * @var int
	 */
	public $event_date_id;

	/**
	 * Group ID
	 *
	 * @var int
	 */
	public $group_id;

	/**
	 * Permission type (view_signups, manage_signups)
	 *
	 * @var string
	 */
	public $permission_type;

	/**
	 * Created at timestamp
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated at timestamp
	 *
	 * @var string
	 */
	public $updated_at;

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	private static function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_group_permission_rules';
	}

	/**
	 * Get rule by ID
	 *
	 * @param int $id Rule ID.
	 * @return GroupPermissionRule|null Rule object or null if not found.
	 */
	public static function get_by_id( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d LIMIT 1',
				$table_name,
				$id
			)
		);

		if ( ! $result ) {
			return null;
		}

		return self::hydrate( $result );
	}

	/**
	 * Get all rules for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return GroupPermissionRule[] Array of GroupPermissionRule objects.
	 */
	public static function get_all_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY id ASC',
				$table_name,
				$event_date_id
			)
		);

		if ( ! $results ) {
			return array();
		}

		$rules = array();
		foreach ( $results as $result ) {
			$rules[] = self::hydrate( $result );
		}

		return $rules;
	}

	/**
	 * Get rules for a specific event date and group
	 *
	 * @param int $event_date_id Event date ID.
	 * @param int $group_id      Group ID.
	 * @return GroupPermissionRule[] Array of GroupPermissionRule objects.
	 */
	public static function get_by_event_date_and_group( $event_date_id, $group_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d AND group_id = %d ORDER BY id ASC',
				$table_name,
				$event_date_id,
				$group_id
			)
		);

		if ( ! $results ) {
			return array();
		}

		$rules = array();
		foreach ( $results as $result ) {
			$rules[] = self::hydrate( $result );
		}

		return $rules;
	}

	/**
	 * Create a new group permission rule
	 *
	 * @param int    $event_date_id  Event date ID.
	 * @param int    $group_id       Group ID.
	 * @param string $permission_type Permission type.
	 * @return int|false The rule ID on success, false on failure.
	 */
	public static function create( $event_date_id, $group_id, $permission_type ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->insert(
			$table_name,
			array(
				'event_date_id'   => $event_date_id,
				'group_id'        => $group_id,
				'permission_type' => $permission_type,
			),
			array( '%d', '%d', '%s' )
		);

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Delete a group permission rule
	 *
	 * @param int $id Rule ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete( $id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array( 'id' => $id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete all rules for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return bool True on success, false on failure.
	 */
	public static function delete_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->delete(
			$table_name,
			array( 'event_date_id' => $event_date_id ),
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Hydrate a rule object from a database row
	 *
	 * @param object $row Database row.
	 * @return GroupPermissionRule Rule object.
	 */
	private static function hydrate( $row ) {
		$rule                  = new self();
		$rule->id              = (int) $row->id;
		$rule->event_date_id   = (int) $row->event_date_id;
		$rule->group_id        = (int) $row->group_id;
		$rule->permission_type = $row->permission_type;
		$rule->created_at      = $row->created_at;
		$rule->updated_at      = $row->updated_at;

		return $rule;
	}

	/**
	 * Convert rule to array
	 *
	 * @return array Rule data as array.
	 */
	public function to_array() {
		return array(
			'id'              => $this->id,
			'event_date_id'   => $this->event_date_id,
			'group_id'        => $this->group_id,
			'permission_type' => $this->permission_type,
			'created_at'      => $this->created_at,
			'updated_at'      => $this->updated_at,
		);
	}
}
