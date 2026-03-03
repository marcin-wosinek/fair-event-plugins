<?php
/**
 * Group Pricing Rule model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Group Pricing Rule model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class GroupPricingRule {

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
	 * Discount type (percentage or amount)
	 *
	 * @var string
	 */
	public $discount_type;

	/**
	 * Discount value
	 *
	 * @var float
	 */
	public $discount_value;

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
		return $wpdb->prefix . 'fair_events_group_pricing_rules';
	}

	/**
	 * Get rule by ID
	 *
	 * @param int $id Rule ID.
	 * @return GroupPricingRule|null Rule object or null if not found.
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
	 * @return GroupPricingRule[] Array of GroupPricingRule objects.
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
	 * Create a new group pricing rule
	 *
	 * @param int    $event_date_id Event date ID.
	 * @param int    $group_id      Group ID.
	 * @param string $discount_type Discount type (percentage or amount).
	 * @param float  $discount_value Discount value.
	 * @return int|false The rule ID on success, false on failure.
	 */
	public static function create( $event_date_id, $group_id, $discount_type, $discount_value ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$result = $wpdb->insert(
			$table_name,
			array(
				'event_date_id'  => $event_date_id,
				'group_id'       => $group_id,
				'discount_type'  => $discount_type,
				'discount_value' => $discount_value,
			),
			array( '%d', '%d', '%s', '%f' )
		);

		if ( $result ) {
			return $wpdb->insert_id;
		}

		return false;
	}

	/**
	 * Update a group pricing rule
	 *
	 * @param int   $id   Rule ID.
	 * @param array $data Data to update (discount_type, discount_value).
	 * @return bool True on success, false on failure.
	 */
	public static function update( $id, $data ) {
		global $wpdb;

		$table_name = self::get_table_name();

		$update_data   = array();
		$update_format = array();

		if ( isset( $data['discount_type'] ) ) {
			$update_data['discount_type'] = $data['discount_type'];
			$update_format[]              = '%s';
		}

		if ( isset( $data['discount_value'] ) ) {
			$update_data['discount_value'] = $data['discount_value'];
			$update_format[]               = '%f';
		}

		if ( empty( $update_data ) ) {
			return false;
		}

		$result = $wpdb->update(
			$table_name,
			$update_data,
			array( 'id' => $id ),
			$update_format,
			array( '%d' )
		);

		return false !== $result;
	}

	/**
	 * Delete a group pricing rule
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
	 * @return GroupPricingRule Rule object.
	 */
	private static function hydrate( $row ) {
		$rule                 = new self();
		$rule->id             = (int) $row->id;
		$rule->event_date_id  = (int) $row->event_date_id;
		$rule->group_id       = (int) $row->group_id;
		$rule->discount_type  = $row->discount_type;
		$rule->discount_value = (float) $row->discount_value;
		$rule->created_at     = $row->created_at;
		$rule->updated_at     = $row->updated_at;

		return $rule;
	}

	/**
	 * Convert rule to array
	 *
	 * @return array Rule data as array.
	 */
	public function to_array() {
		return array(
			'id'             => $this->id,
			'event_date_id'  => $this->event_date_id,
			'group_id'       => $this->group_id,
			'discount_type'  => $this->discount_type,
			'discount_value' => $this->discount_value,
			'created_at'     => $this->created_at,
			'updated_at'     => $this->updated_at,
		);
	}
}
