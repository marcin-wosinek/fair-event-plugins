<?php
/**
 * PostTeamMember Repository
 *
 * @package FairTeam
 */

namespace FairTeam\Database;

use FairTeam\Models\PostTeamMember;

defined( 'WPINC' ) || die;

/**
 * Repository class for post-team member relationships.
 *
 * Provides data access methods for the junction table.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PostTeamMemberRepository {

	/**
	 * Get the table name.
	 *
	 * @return string Table name with prefix.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_team_post_members';
	}

	/**
	 * Get all team members for a post.
	 *
	 * @param int $post_id Post ID.
	 * @return PostTeamMember[] Array of PostTeamMember objects.
	 */
	public function get_by_post( $post_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE post_id = %d ORDER BY created_at ASC',
				$table_name,
				$post_id
			),
			ARRAY_A
		);

		return array_map(
			function ( $row ) {
				return new PostTeamMember( $row );
			},
			$results
		);
	}

	/**
	 * Get specific relationship.
	 *
	 * @param int $post_id Post ID.
	 * @param int $team_member_id Team member post ID.
	 * @return PostTeamMember|null PostTeamMember object or null if not found.
	 */
	public function get_by_post_and_team_member( $post_id, $team_member_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE post_id = %d AND team_member_id = %d',
				$table_name,
				$post_id,
				$team_member_id
			),
			ARRAY_A
		);

		return $result ? new PostTeamMember( $result ) : null;
	}

	/**
	 * Add team member to post.
	 *
	 * @param int $post_id Post ID.
	 * @param int $team_member_id Team member post ID.
	 * @return int|false Relationship ID on success, false on failure.
	 */
	public function add_team_member_to_post( $post_id, $team_member_id ) {
		$existing = $this->get_by_post_and_team_member( $post_id, $team_member_id );
		if ( $existing ) {
			return false; // Already exists.
		}

		$relationship = new PostTeamMember(
			array(
				'post_id'        => $post_id,
				'team_member_id' => $team_member_id,
			)
		);

		return $relationship->save() ? $relationship->id : false;
	}

	/**
	 * Remove team member from post.
	 *
	 * @param int $post_id Post ID.
	 * @param int $team_member_id Team member post ID.
	 * @return bool True on success, false on failure.
	 */
	public function remove_team_member_from_post( $post_id, $team_member_id ) {
		$relationship = $this->get_by_post_and_team_member( $post_id, $team_member_id );

		if ( ! $relationship ) {
			return false;
		}

		return $relationship->delete();
	}
}
