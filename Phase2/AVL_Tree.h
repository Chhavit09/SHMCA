#pragma once
#include <vector>
#include <cmath>

// DSA Unit 4: AVL Trees node structure
struct AVLNode {
    long long key;
    std::vector<int> debrisIds;
    AVLNode *left;
    AVLNode *right;
    int height;
};