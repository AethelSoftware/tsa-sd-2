#vector_db.py
import numpy as np

class VectorDB:
    def __init__(self, t: float):
        self.vectors = []  # Will be list of numpy arrays
        self.values = []  # This will be the list of cached responses
        self.threshold = t  # Cosine similarity threshold value initialized here

    def insert(self, vector, value):
        # Insert the vector and value parameters into the correct lists
        if isinstance(vector, np.ndarray):
            self.vectors.append(vector)
        else:
            self.vectors.append(np.array(vector))
        self.values.append(value)

    def compare(self, new_vector):
        # Use cosine similarity to compare the new vector with each vector in the vectors list
        if not self.vectors:
            return None
        
        # Ensure new_vector is numpy array
        if not isinstance(new_vector, np.ndarray):
            new_vector = np.array(new_vector)
        
        cosine_similarities = []
        for i, vec in enumerate(self.vectors):
            # Ensure vec is numpy array
            if not isinstance(vec, np.ndarray):
                vec = np.array(vec)
            
            # Calculate cosine similarity
            norm_vec = np.linalg.norm(vec)
            norm_new = np.linalg.norm(new_vector)
            
            if norm_vec == 0 or norm_new == 0:
                similarity = 0.0
            else:
                similarity = np.dot(vec, new_vector) / (norm_vec * norm_new)
            
            cosine_similarities.append(float(similarity))
        
        max_similarity = max(cosine_similarities) if cosine_similarities else 0.0
        
        if max_similarity >= self.threshold:
            max_index = cosine_similarities.index(max_similarity)
            return {
                "similarity": max_similarity, 
                "value": self.values[max_index]
            }
        return None