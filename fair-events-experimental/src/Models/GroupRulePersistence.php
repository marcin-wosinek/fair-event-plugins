<?php
/**
 * Shared persistence for the group permission and group pricing rule tables
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Models;

defined( 'WPINC' ) || die;

/**
 * Lookup and deletion queries common to the two group-rule tables.
 *
 * Each instance is bound to one of the two rule tables through a named
 * constructor, so callers cannot point it at any other table or pass SQL.
 * It returns raw database rows; hydration stays in the owning model.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
final class GroupRulePersistence {

	/**
	 * Unprefixed group permission rules table.
	 */
	const PERMISSION_RULES_TABLE = 'fair_events_group_permission_rules';

	/**
	 * Unprefixed group pricing rules table.
	 */
	const PRICING_RULES_TABLE = 'fair_events_group_pricing_rules';

	/**
	 * Unprefixed table this instance targets.
	 *
	 * @var string
	 */
	private $table;

	/**
	 * Bind the helper to a rule table.
	 *
	 * @param string $table One of the class's table constants.
	 */
	private function __construct( $table ) {
		$this->table = $table;
	}

	/**
	 * Persistence for group permission rules.
	 *
	 * @return self
	 */
	public static function permission_rules() {
		return new self( self::PERMISSION_RULES_TABLE );
	}

	/**
	 * Persistence for group pricing rules.
	 *
	 * @return self
	 */
	public static function pricing_rules() {
		return new self( self::PRICING_RULES_TABLE );
	}

	/**
	 * Prefixed name of the bound table.
	 *
	 * @return string
	 */
	public function table_name() {
		global $wpdb;
		return $wpdb->prefix . $this->table;
	}

	/**
	 * Get one rule row by ID.
	 *
	 * @param int $id Rule ID.
	 * @return object|null Row, or null when missing or the query fails.
	 */
	public function get_row_by_id( $id ) {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d LIMIT 1',
				$this->table_name(),
				$id
			)
		);

		return $row ? $row : null;
	}

	/**
	 * Get an event date's rule rows in ascending ID order.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return object[] Rows; empty when none match or the query fails.
	 */
	public function get_rows_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY id ASC',
				$this->table_name(),
				$event_date_id
			)
		);

		return $rows ? $rows : array();
	}

	/**
	 * Delete one rule by ID.
	 *
	 * @param int $id Rule ID.
	 * @return bool False only on a database failure; deleting nothing succeeds.
	 */
	public function delete_by_id( $id ) {
		return $this->delete_where( array( 'id' => $id ) );
	}

	/**
	 * Delete every rule of an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return bool False only on a database failure; deleting nothing succeeds.
	 */
	public function delete_by_event_date_id( $event_date_id ) {
		return $this->delete_where( array( 'event_date_id' => $event_date_id ) );
	}

	/**
	 * Delete rows matching one integer column of the bound table.
	 *
	 * @param array $where Single integer column => value; columns are fixed by the public callers.
	 * @return bool False only on a database failure.
	 */
	private function delete_where( array $where ) {
		global $wpdb;

		return false !== $wpdb->delete( $this->table_name(), $where, array( '%d' ) );
	}
}
