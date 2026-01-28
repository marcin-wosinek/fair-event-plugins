<?php
/**
 * Group Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Group model.
 */
class Group {

	/**
	 * Group ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Group name.
	 *
	 * @var string
	 */
	public $name;

	/**
	 * Group description.
	 *
	 * @var string
	 */
	public $description;

	/**
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated timestamp.
	 *
	 * @var string
	 */
	public $updated_at;

	/**
	 * Constructor.
	 *
	 * @param array $data Optional data to populate.
	 */
	public function __construct( $data = array() ) {
		if ( ! empty( $data ) ) {
			$this->populate( $data );
		}
	}

	/**
	 * Populate from data array.
	 *
	 * @param array $data Data array.
	 */
	public function populate( $data ) {
		$this->id          = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->name        = isset( $data['name'] ) ? sanitize_text_field( $data['name'] ) : '';
		$this->description = isset( $data['description'] ) ? sanitize_textarea_field( $data['description'] ) : '';
		$this->created_at  = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at  = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_groups';

		// Validate required fields.
		if ( empty( $this->name ) ) {
			return false;
		}

		$data = array(
			'name'        => $this->name,
			'description' => $this->description,
		);

		$format = array( '%s', '%s' );

		if ( $this->id ) {
			// Update existing.
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $this->id ),
				$format,
				array( '%d' )
			);
		} else {
			// Insert new.
			$result = $wpdb->insert( $table_name, $data, $format );
			if ( $result ) {
				$this->id = $wpdb->insert_id;
			}
		}

		return false !== $result;
	}

	/**
	 * Delete from database.
	 *
	 * @return bool Success.
	 */
	public function delete() {
		global $wpdb;

		if ( ! $this->id ) {
			return false;
		}

		$table_name = $wpdb->prefix . 'fair_audience_groups';

		// First delete all group participants.
		$junction_table = $wpdb->prefix . 'fair_audience_group_participants';
		$wpdb->delete(
			$junction_table,
			array( 'group_id' => $this->id ),
			array( '%d' )
		);

		// Then delete the group.
		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
