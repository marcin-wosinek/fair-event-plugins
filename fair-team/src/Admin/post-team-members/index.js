import { render } from '@wordpress/element';
import PostTeamMembers from './PostTeamMembers.js';

const root = document.getElementById('fair-team-members-root');
if (root) {
	render(<PostTeamMembers />, root);
}
