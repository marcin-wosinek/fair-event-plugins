<?php
/**
 * Post Migration Service
 *
 * @package FairTeam
 */

namespace FairTeam\Services;

use FairTeam\PostTypes\TeamMember;

defined( 'WPINC' ) || die;

/**
 * Service for migrating posts to team members
 */
class PostMigrationService {

	/**
	 * Migrate a post to team member
	 *
	 * @param int $post_id Post ID to migrate.
	 * @return int|\WP_Error Team member ID on success, WP_Error on failure.
	 */
	public function migrate_post( $post_id ) {
		// 1. Validate source post exists.
		$source_post = get_post( $post_id );

		if ( ! $source_post ) {
			return new \WP_Error(
				'invalid_post',
				__( 'Source post not found.', 'fair-team' ),
				array( 'status' => 404 )
			);
		}

		// 2. Validate post is not already a team member.
		if ( TeamMember::POST_TYPE === $source_post->post_type ) {
			return new \WP_Error(
				'already_team_member',
				__( 'Post is already a team member.', 'fair-team' ),
				array( 'status' => 400 )
			);
		}

		// 3. Check user has permission to edit this post.
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new \WP_Error(
				'permission_denied',
				__( 'You do not have permission to edit this post.', 'fair-team' ),
				array( 'status' => 403 )
			);
		}

		// 4. Create team member post with same data.
		$team_member_data = array(
			'post_type'    => TeamMember::POST_TYPE,
			'post_title'   => $source_post->post_title,
			'post_content' => $source_post->post_content,
			'post_excerpt' => $source_post->post_excerpt,
			'post_author'  => $source_post->post_author,
			'post_status'  => 'publish',
		);

		$team_member_id = wp_insert_post( $team_member_data, true );

		if ( is_wp_error( $team_member_id ) ) {
			return new \WP_Error(
				'creation_failed',
				__( 'Failed to create team member post.', 'fair-team' ),
				array( 'status' => 500 )
			);
		}

		// 5. Copy featured image if exists.
		$thumbnail_id = get_post_thumbnail_id( $post_id );
		if ( $thumbnail_id ) {
			set_post_thumbnail( $team_member_id, $thumbnail_id );
		}

		// 6. Set source post to draft.
		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'draft',
			)
		);

		// 7. Fire action hook for extensibility.
		do_action( 'fair_team_post_migrated', $team_member_id, $post_id, $source_post );

		return $team_member_id;
	}
}
